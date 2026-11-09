const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const verificarAutenticacao = require('../middlewares/middleware');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAPEIS = new Set(['owner', 'direcao', 'professor', 'tesouraria', 'secretaria']);
const PAPEIS_PUBLICACAO = new Set(['owner', 'direcao', 'professor']);
const extensoesMime = new Map([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);
const ficheirosDir = path.resolve(__dirname, '../private_uploads/partilhados');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
});

function normalizarPapel(papel) {
  const normalizado = String(papel || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalizado === 'escola' ? 'direcao' : normalizado;
}

function receberFicheiro(req, res, next) {
  upload.single('ficheiro')(req, res, (error) => {
    if (!error) return next();
    const limite = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(limite ? 413 : 400).json({
      success: false,
      message: limite ? 'O ficheiro excede o limite de 15 MB.' : 'Não foi possível receber o ficheiro.'
    });
  });
}

function validarFicheiro(file) {
  if (!file) return false;
  const extensao = path.extname(file.originalname).toLowerCase();
  if (extensoesMime.get(extensao) !== file.mimetype) return false;
  const buffer = file.buffer;
  if (extensao === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extensao === '.jpg' || extensao === '.jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extensao === '.png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extensao === '.webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

async function obterContexto(req, escolaSolicitada) {
  if (!req.user?.id) return null;
  if (req.user.isOwner === true) {
    if (!UUID_PATTERN.test(escolaSolicitada || '')) return null;
    const escola = await db.query('SELECT id FROM escolas WHERE id = $1', [escolaSolicitada]);
    return escola.rowCount ? { escolaId: escolaSolicitada, papel: 'owner' } : null;
  }

  const escolaId = req.contaAtiva?.escola_id;
  const papel = normalizarPapel(req.contaAtiva?.papel_norm || req.contaAtiva?.papel);
  if (!UUID_PATTERN.test(escolaId || '') || !PAPEIS.has(papel)) return null;
  if (escolaSolicitada && escolaSolicitada !== escolaId) return null;

  const associacoes = await db.query(
    `SELECT pu.papel
     FROM associacoes_escola ae
     JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
     WHERE ae.escola_id = $1 AND ae.utilizador_id = $2
       AND (ae.status IS NULL OR ae.status = 'ativo')`,
    [escolaId, req.user.id]
  );
  const papelAtivo = associacoes.rows.some((associacao) => normalizarPapel(associacao.papel) === papel);
  return papelAtivo ? { escolaId, papel } : null;
}

function podeConsultar(documento, contexto, utilizadorId) {
  if (documento.visibilidade === 'publico') return true;
  return documento.carregado_por === utilizadorId
    || documento.destinatarios.includes(contexto.papel);
}

function enviarFicheiro(res, caminho, documento, publico) {
  const extensao = path.extname(documento.nome_original).toLowerCase();
  const inline = documento.tipo_mime === 'application/pdf' || documento.tipo_mime.startsWith('image/');
  res.set({
    'Content-Type': documento.tipo_mime,
    'Content-Length': String(documento.tamanho_bytes),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(documento.nome_original) || `ficheiro${extensao}`)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': publico ? 'public, max-age=300' : 'private, no-store'
  });
  const stream = fs.createReadStream(caminho);
  stream.on('error', (error) => {
    console.error('Erro ao transmitir ficheiro partilhado:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Não foi possível transmitir o ficheiro.' });
    else res.destroy(error);
  });
  stream.pipe(res);
}

router.get('/contexto', verificarAutenticacao, async (req, res) => {
  try {
    if (req.user?.isOwner === true) {
      const escolas = await db.query('SELECT id, nome, sigla, cor_primaria FROM escolas ORDER BY nome');
      return res.json({
        success: true,
        dados: { papel: 'owner', escola_id: null, escolas: escolas.rows, pode_publicar: true }
      });
    }

    const contexto = await obterContexto(req);
    if (!contexto) {
      return res.status(403).json({ success: false, message: 'O perfil atual não pode utilizar a partilha de ficheiros.' });
    }
    return res.json({
      success: true,
      dados: {
        papel: contexto.papel,
        escola_id: contexto.escolaId,
        escolas: [],
        pode_publicar: PAPEIS_PUBLICACAO.has(contexto.papel)
      }
    });
  } catch (error) {
    console.error('Erro ao carregar contexto da partilha:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o contexto da partilha.' });
  }
});

router.get('/ficheiros', verificarAutenticacao, async (req, res) => {
  try {
    const contexto = await obterContexto(req, req.query.escola_id);
    if (!contexto) {
      return res.status(403).json({ success: false, message: 'Selecione uma escola válida e autorizada.' });
    }
    const resultado = await db.query(
      `SELECT f.id, f.escola_id, e.nome AS escola_nome, f.carregado_por,
              f.papel_carregador, f.titulo, f.descricao, f.nome_original,
              f.tipo_mime, f.tamanho_bytes, f.visibilidade, f.destinatarios, f.criado_em,
              u.nome AS autor_nome
       FROM ficheiros_partilhados f
       JOIN escolas e ON e.id = f.escola_id
       JOIN utilizadores u ON u.id = f.carregado_por
       WHERE f.escola_id = $1 AND f.estado = 'ativo'
         AND (f.visibilidade = 'publico' OR f.carregado_por = $2 OR $3 = ANY(f.destinatarios))
       ORDER BY f.criado_em DESC
       LIMIT 500`,
      [contexto.escolaId, req.user.id, contexto.papel]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar ficheiros partilhados:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os ficheiros partilhados.' });
  }
});

router.post('/ficheiros', verificarAutenticacao, receberFicheiro, async (req, res) => {
  let caminho;
  try {
    const contexto = await obterContexto(req, req.body?.escola_id);
    if (!contexto) {
      return res.status(403).json({ success: false, message: 'Selecione uma escola válida e autorizada.' });
    }
    if (!validarFicheiro(req.file)) {
      return res.status(400).json({ success: false, message: 'Anexe um PDF, DOCX ou uma imagem JPEG, PNG ou WEBP válida.' });
    }

    const { titulo, descricao = '', visibilidade = 'privado', destinatarios: destinatariosRaw = '[]' } = req.body;
    if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180
      || typeof descricao !== 'string' || descricao.length > 2000
      || !['privado', 'publico'].includes(visibilidade)) {
      return res.status(400).json({ success: false, message: 'Título, descrição ou visibilidade inválidos.' });
    }
    let destinatarios;
    try {
      destinatarios = JSON.parse(destinatariosRaw);
    } catch {
      return res.status(400).json({ success: false, message: 'Selecione perfis de destino válidos.' });
    }
    if (!Array.isArray(destinatarios) || destinatarios.some((papel) => !PAPEIS.has(papel))) {
      return res.status(400).json({ success: false, message: 'Selecione perfis de destino válidos.' });
    }
    destinatarios = [...new Set(destinatarios)];

    if (visibilidade === 'publico' && !PAPEIS_PUBLICACAO.has(contexto.papel)) {
      return res.status(403).json({ success: false, message: 'Este perfil só pode publicar ficheiros privados.' });
    }
    if (visibilidade === 'privado' && destinatarios.length === 0) {
      return res.status(400).json({ success: false, message: 'Selecione pelo menos um perfil destinatário.' });
    }
    if (visibilidade === 'publico') destinatarios = [];

    const extensao = path.extname(req.file.originalname).toLowerCase();
    const nomeArmazenado = `${crypto.randomUUID()}${extensao}`;
    await fs.promises.mkdir(ficheirosDir, { recursive: true });
    caminho = path.join(ficheirosDir, nomeArmazenado);
    await fs.promises.writeFile(caminho, req.file.buffer, { flag: 'wx' });
    const nomeOriginal = path.basename(req.file.originalname).replace(/[\r\n]/g, '').slice(0, 255);
    const resultado = await db.query(
      `INSERT INTO ficheiros_partilhados (
         escola_id, carregado_por, papel_carregador, titulo, descricao,
         nome_original, nome_armazenado, tipo_mime, tamanho_bytes,
         visibilidade, destinatarios
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[])
       RETURNING id, escola_id, titulo, descricao, nome_original, tipo_mime,
                 tamanho_bytes, visibilidade, destinatarios, criado_em`,
      [
        contexto.escolaId, req.user.id, contexto.papel, titulo.trim(), descricao.trim(),
        nomeOriginal, nomeArmazenado, req.file.mimetype, req.file.size,
        visibilidade, destinatarios
      ]
    );
    return res.status(201).json({ success: true, message: 'Ficheiro carregado com sucesso.', dados: resultado.rows[0] });
  } catch (error) {
    if (caminho) {
      await fs.promises.unlink(caminho).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') console.error('Erro ao limpar ficheiro após falha do registo:', cleanupError);
      });
    }
    console.error('Erro ao guardar ficheiro partilhado:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível guardar o ficheiro.' });
  }
});

router.get('/publicos', async (req, res) => {
  try {
    const escolaId = req.query.escola_id || null;
    if (escolaId && !UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: 'Identificador da escola inválido.' });
    }
    const resultado = await db.query(
      `SELECT f.id, f.escola_id, e.nome AS escola_nome, e.sigla AS escola_sigla,
              f.titulo, f.descricao, f.nome_original, f.tipo_mime,
              f.tamanho_bytes, f.criado_em, u.nome AS autor_nome
       FROM ficheiros_partilhados f
       JOIN escolas e ON e.id = f.escola_id
       JOIN utilizadores u ON u.id = f.carregado_por
       WHERE f.visibilidade = 'publico' AND f.estado = 'ativo'
         AND ($1::uuid IS NULL OR f.escola_id = $1)
       ORDER BY f.criado_em DESC
       LIMIT 500`,
      [escolaId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar ficheiros públicos:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os ficheiros públicos.' });
  }
});

router.get('/publicos/:id/ficheiro', async (req, res) => {
  try {
    if (!UUID_PATTERN.test(req.params.id || '')) {
      return res.status(400).json({ success: false, message: 'Identificador de ficheiro inválido.' });
    }
    const resultado = await db.query(
      `SELECT nome_armazenado, nome_original, tipo_mime, tamanho_bytes
       FROM ficheiros_partilhados
       WHERE id = $1 AND visibilidade = 'publico' AND estado = 'ativo'`,
      [req.params.id]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Ficheiro público não encontrado.' });
    const ficheiro = resultado.rows[0];
    const caminho = path.resolve(ficheirosDir, path.basename(ficheiro.nome_armazenado));
    await fs.promises.access(caminho, fs.constants.R_OK);
    return enviarFicheiro(res, caminho, ficheiro, true);
  } catch (error) {
    console.error('Erro ao abrir ficheiro público:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível abrir o ficheiro público.' });
  }
});

router.get('/ficheiros/:id/ficheiro', verificarAutenticacao, async (req, res) => {
  try {
    if (!UUID_PATTERN.test(req.params.id || '')) {
      return res.status(400).json({ success: false, message: 'Identificador de ficheiro inválido.' });
    }
    const resultado = await db.query(
      `SELECT f.escola_id, f.carregado_por, f.visibilidade, f.destinatarios,
              f.nome_armazenado, f.nome_original, f.tipo_mime, f.tamanho_bytes
       FROM ficheiros_partilhados f
       WHERE f.id = $1 AND f.estado = 'ativo'`,
      [req.params.id]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Ficheiro não encontrado.' });
    const ficheiro = resultado.rows[0];
    const contexto = await obterContexto(req, ficheiro.escola_id);
    if (!contexto || !podeConsultar(ficheiro, contexto, req.user.id)) {
      return res.status(403).json({ success: false, message: 'Não tem autorização para abrir este ficheiro.' });
    }
    const caminho = path.resolve(ficheirosDir, path.basename(ficheiro.nome_armazenado));
    await fs.promises.access(caminho, fs.constants.R_OK);
    return enviarFicheiro(res, caminho, ficheiro, false);
  } catch (error) {
    console.error('Erro ao abrir ficheiro partilhado:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível abrir o ficheiro.' });
  }
});

module.exports = router;
