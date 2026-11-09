const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MEDIA_UPLOAD_DIR = path.resolve(__dirname, '../public/uploads/media');
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf']
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

function receberFicheiro(req, res, next) {
  upload.single('ficheiro')(req, res, (error) => {
    if (!error) return next();
    const limite = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(limite ? 413 : 400).json({
      success: false,
      message: limite ? 'O ficheiro excede o limite de 10 MB.' : 'Não foi possível receber o ficheiro.'
    });
  });
}

function normalizarPapel(papel) {
  return String(papel || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function verificarDirecao(req, res, next) {
  const papel = normalizarPapel(req.contaAtiva?.papel_norm || req.contaAtiva?.papel);
  const escolaId = req.contaAtiva?.escola_id;
  if (papel !== 'direcao' || !UUID_PATTERN.test(escolaId || '')) {
    return res.status(403).json({ success: false, message: 'Apenas a Direção pode gerir o portal da escola.' });
  }
  req.mediaEscolaId = escolaId;
  return next();
}

function validarUrlPublica(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (/^\/uploads\/media\/[a-f0-9-]+\.(jpg|png|webp|pdf)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function ficheiroValido(file, tiposPermitidos) {
  if (!file || !tiposPermitidos.has(file.mimetype)) return false;
  const buffer = file.buffer;
  if (file.mimetype === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (file.mimetype === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (file.mimetype === 'image/webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return file.mimetype === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

async function guardarFicheiro(file) {
  await fs.promises.mkdir(MEDIA_UPLOAD_DIR, { recursive: true });
  const extensao = MIME_EXTENSIONS.get(file.mimetype);
  const nome = `${crypto.randomUUID()}${extensao}`;
  const caminho = path.join(MEDIA_UPLOAD_DIR, nome);
  await fs.promises.writeFile(caminho, file.buffer, { flag: 'wx' });
  return { url: `/uploads/media/${nome}`, caminho };
}

async function removerFicheiroLocal(url) {
  const match = typeof url === 'string' && url.match(/^\/uploads\/media\/([a-f0-9-]+\.(?:jpg|png|webp|pdf))$/i);
  if (!match) return;
  const caminho = path.join(MEDIA_UPLOAD_DIR, path.basename(match[1]));
  try {
    await fs.promises.unlink(caminho);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function obterEscolaPublica(subdominio) {
  const valor = String(subdominio || '').trim().toLowerCase();
  if (!SUBDOMAIN_PATTERN.test(valor)) return null;
  const resultado = await db.query(
    `SELECT id FROM escolas
     WHERE LOWER(TRIM(subdominio)) = $1
       AND status_verificacao IN ('ativo', 'verified')
     LIMIT 1`,
    [valor]
  );
  return resultado.rows[0] || null;
}

router.get('/public/:subdominio', async (req, res) => {
  try {
    const escola = await obterEscolaPublica(req.params.subdominio);
    if (!escola) {
      return res.status(404).json({ success: false, message: 'Escola não encontrada ou inativa.' });
    }

    const [fotos, matriculas, livros, comentarios, publicacoes] = await Promise.all([
      db.query(
        `SELECT id, titulo, categoria, imagem_url, criado_em
         FROM media_fotos WHERE escola_id = $1
         ORDER BY criado_em DESC LIMIT 100`,
        [escola.id]
      ),
      db.query(
        `SELECT m.numero_matricula, al.ano_nome
         FROM media_matriculas_publicadas mp
         JOIN matriculas m ON m.id = mp.matricula_id AND m.escola_id = mp.escola_id
         JOIN matriculas_decisoes_direcao d ON d.matricula_id = m.id AND d.decisao = 'aprovado'
         JOIN anos_letivos al ON al.id = m.ano_letivo_id
         WHERE mp.escola_id = $1 AND m.estado = 'ativa'
         ORDER BY al.ano_nome DESC, m.numero_matricula
         LIMIT 500`,
        [escola.id]
      ),
      db.query(
        `SELECT id::text AS id, titulo, autor, descricao, ficheiro_url, criado_em,
                NULL::text AS tipo_mime, NULL::text AS nome_original
         FROM media_livros WHERE escola_id = $1
         UNION ALL
         SELECT 'partilha-' || f.id::text AS id, f.titulo, '' AS autor,
                COALESCE(NULLIF(f.descricao, ''), f.nome_original) AS descricao,
                '/api/v1/uploads/publicos/' || f.id::text || '/ficheiro' AS ficheiro_url,
                f.criado_em, f.tipo_mime, f.nome_original
         FROM ficheiros_partilhados f
         WHERE f.escola_id = $1 AND f.visibilidade = 'publico' AND f.estado = 'ativo'
         ORDER BY criado_em DESC
         LIMIT 200`,
        [escola.id]
      ),
      db.query(
        `SELECT id, nome, comentario, criado_em
         FROM media_comentarios
         WHERE escola_id = $1 AND estado = 'aprovado'
         ORDER BY criado_em DESC LIMIT 100`,
        [escola.id]
      ),
      db.query(
        `SELECT id, titulo, resumo, conteudo, categoria, imagem_url, criado_em
         FROM media_publicacoes
         WHERE escola_id = $1 AND estado = 'publicado'
         ORDER BY criado_em DESC LIMIT 100`,
        [escola.id]
      )
    ]);

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: {
        fotos: fotos.rows,
        matriculas_admitidas: matriculas.rows,
        livros: livros.rows,
        comentarios: comentarios.rows,
        publicacoes: publicacoes.rows
      }
    });
  } catch (error) {
    console.error('Erro ao carregar conteúdo público da mídia:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o conteúdo do portal.' });
  }
});

router.post('/public/:subdominio/comentarios', async (req, res) => {
  const nome = req.body?.nome;
  const comentario = req.body?.comentario;
  if (typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 120
    || typeof comentario !== 'string' || comentario.trim().length < 2 || comentario.trim().length > 1200) {
    return res.status(400).json({ success: false, message: 'Informe o nome e um comentário de até 1200 caracteres.' });
  }

  try {
    const escola = await obterEscolaPublica(req.params.subdominio);
    if (!escola) {
      return res.status(404).json({ success: false, message: 'Escola não encontrada ou inativa.' });
    }
    await db.query(
      `INSERT INTO media_comentarios (escola_id, nome, comentario)
       VALUES ($1, $2, $3)`,
      [escola.id, nome.trim(), comentario.trim()]
    );
    return res.status(201).json({
      success: true,
      message: 'Comentário enviado. Ficará visível depois da aprovação da Direção.'
    });
  } catch (error) {
    console.error('Erro ao receber comentário do portal:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível enviar o comentário.' });
  }
});

router.get('/admin', verificarAutenticacao, verificarDirecao, async (req, res) => {
  try {
    const escolaId = req.mediaEscolaId;
    const [escola, fotos, matriculas, comentarios, livros, publicacoes] = await Promise.all([
      db.query(
        `SELECT id, nome, sigla, subdominio, endereco, local, sector, regime_periodo,
                motto, missao, visao, valor
         FROM escolas WHERE id = $1`,
        [escolaId]
      ),
      db.query(
        `SELECT id, titulo, categoria, imagem_url, criado_em
         FROM media_fotos WHERE escola_id = $1
         ORDER BY criado_em DESC`,
        [escolaId]
      ),
      db.query(
        `SELECT m.id, m.numero_matricula, al.ano_nome,
                EXISTS (
                  SELECT 1 FROM media_matriculas_publicadas mp
                  WHERE mp.escola_id = m.escola_id AND mp.matricula_id = m.id
                ) AS publicada
         FROM matriculas m
         JOIN matriculas_decisoes_direcao d ON d.matricula_id = m.id AND d.decisao = 'aprovado'
         JOIN anos_letivos al ON al.id = m.ano_letivo_id
         WHERE m.escola_id = $1 AND m.estado = 'ativa'
         ORDER BY al.ano_nome DESC, m.numero_matricula`,
        [escolaId]
      ),
      db.query(
        `SELECT id, nome, comentario, estado, criado_em
         FROM media_comentarios WHERE escola_id = $1
         ORDER BY criado_em DESC LIMIT 500`,
        [escolaId]
      ),
      db.query(
        `SELECT id, titulo, autor, descricao, ficheiro_url, criado_em
         FROM media_livros WHERE escola_id = $1
         ORDER BY criado_em DESC`,
        [escolaId]
      ),
      db.query(
        `SELECT id, titulo, resumo, conteudo, categoria, imagem_url, estado, criado_em
         FROM media_publicacoes WHERE escola_id = $1
         ORDER BY criado_em DESC`,
        [escolaId]
      )
    ]);
    if (!escola.rowCount) {
      return res.status(404).json({ success: false, message: 'A escola ativa não foi encontrada.' });
    }
    return res.json({
      success: true,
      data: {
        informacoes: escola.rows[0],
        fotos: fotos.rows,
        matriculas_admitidas: matriculas.rows,
        comentarios: comentarios.rows,
        livros: livros.rows,
        publicacoes: publicacoes.rows
      }
    });
  } catch (error) {
    console.error('Erro ao carregar o painel de mídia:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a gestão de mídia.' });
  }
});

router.put('/informacoes', verificarAutenticacao, verificarDirecao, async (req, res) => {
  const campos = {
    motto: { max: 180 },
    endereco: { max: 255 },
    local: { max: 120 },
    sector: { max: 120 },
    regime_periodo: { max: 80 },
    missao: { max: 255 },
    visao: { max: 3000, palavras: 500 },
    valor: { max: 255 }
  };
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const atualizacoes = Object.entries(campos)
    .filter(([campo]) => Object.hasOwn(body, campo))
    .map(([campo, regra]) => {
      const valor = body[campo];
      if (typeof valor !== 'string' || valor.trim().length > regra.max) return { valido: false };
      const texto = valor.trim();
      if (regra.palavras && texto.split(/\s+/).filter(Boolean).length > regra.palavras) return { valido: false };
      return { campo, valor: texto || null, valido: true };
    });
  if (!atualizacoes.length || atualizacoes.some((item) => !item.valido)) {
    return res.status(400).json({ success: false, message: 'As informações institucionais são inválidas ou não foram alteradas.' });
  }

  try {
    const valores = [req.mediaEscolaId];
    const atribuicoes = atualizacoes.map(({ campo, valor }, index) => {
      valores.push(valor);
      return `${campo} = $${index + 2}`;
    });
    const resultado = await db.query(
      `UPDATE escolas SET ${atribuicoes.join(', ')}
       WHERE id = $1
       RETURNING id, nome, sigla, subdominio, endereco, local, sector, regime_periodo,
                 motto, missao, visao, valor`,
      valores
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'A escola ativa não foi encontrada.' });
    return res.json({ success: true, data: resultado.rows[0], message: 'Informações do portal atualizadas.' });
  } catch (error) {
    console.error('Erro ao atualizar informações do portal:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar as informações.' });
  }
});

router.post('/publicacoes', verificarAutenticacao, verificarDirecao, receberFicheiro, async (req, res) => {
  const {
    titulo,
    resumo,
    conteudo,
    categoria = 'Notícia',
    estado = 'publicado',
    imagem_url: imagemUrl = ''
  } = req.body || {};
  if (typeof titulo !== 'string' || titulo.trim().length < 4 || titulo.trim().length > 180
    || typeof resumo !== 'string' || resumo.trim().length < 10 || resumo.trim().length > 320
    || typeof conteudo !== 'string' || conteudo.trim().length < 20 || conteudo.trim().length > 20000
    || typeof categoria !== 'string' || categoria.trim().length > 80
    || !['rascunho', 'publicado'].includes(estado)) {
    return res.status(400).json({
      success: false,
      message: 'Preencha título, resumo e texto completo. O título deve ter 4–180 caracteres, o resumo 10–320 e o texto 20–20000.'
    });
  }
  if (req.file && !ficheiroValido(req.file, new Set(['image/jpeg', 'image/png', 'image/webp']))) {
    return res.status(400).json({ success: false, message: 'A capa deve ser uma imagem JPEG, PNG ou WebP válida.' });
  }
  if (!req.file && imagemUrl) {
    let urlValido = /^\/uploads\/media\/[a-f0-9-]+\.(jpg|png|webp)$/i.test(imagemUrl);
    if (!urlValido) {
      try {
        urlValido = new URL(imagemUrl).protocol === 'https:';
      } catch {
        urlValido = false;
      }
    }
    if (!urlValido || imagemUrl.length > 2048) {
      return res.status(400).json({ success: false, message: 'A capa deve ser uma imagem carregada ou um endereço HTTPS válido.' });
    }
  }

  let ficheiro;
  try {
    if (req.file) ficheiro = await guardarFicheiro(req.file);
    const resultado = await db.query(
      `INSERT INTO media_publicacoes
         (escola_id, titulo, resumo, conteudo, categoria, imagem_url, estado, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, titulo, resumo, conteudo, categoria, imagem_url, estado, criado_em`,
      [
        req.mediaEscolaId,
        titulo.trim(),
        resumo.trim(),
        conteudo.trim(),
        categoria.trim() || 'Notícia',
        ficheiro?.url || imagemUrl.trim(),
        estado,
        req.user.id
      ]
    );
    return res.status(201).json({
      success: true,
      data: resultado.rows[0],
      message: estado === 'publicado' ? 'Publicação publicada no portal.' : 'Rascunho guardado.'
    });
  } catch (error) {
    if (ficheiro) await removerFicheiroLocal(ficheiro.url).catch((cleanupError) => {
      console.error('Erro ao remover capa não registada:', cleanupError);
    });
    console.error('Erro ao criar publicação no portal:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível guardar a publicação.' });
  }
});

router.patch('/publicacoes/:id/estado', verificarAutenticacao, verificarDirecao, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body || {};
  if (!UUID_PATTERN.test(id || '') || !['rascunho', 'publicado'].includes(estado)) {
    return res.status(400).json({ success: false, message: 'Publicação ou estado inválido.' });
  }
  try {
    const resultado = await db.query(
      `UPDATE media_publicacoes
       SET estado = $1, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $2 AND escola_id = $3
       RETURNING id`,
      [estado, id, req.mediaEscolaId]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Publicação não encontrada.' });
    return res.json({
      success: true,
      message: estado === 'publicado' ? 'Publicação visível no portal.' : 'Publicação retirada do portal e guardada como rascunho.'
    });
  } catch (error) {
    console.error('Erro ao alterar estado da publicação:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar a publicação.' });
  }
});

router.delete('/publicacoes/:id', verificarAutenticacao, verificarDirecao, async (req, res) => {
  const { id } = req.params;
  if (!UUID_PATTERN.test(id || '')) return res.status(400).json({ success: false, message: 'Publicação inválida.' });
  try {
    const resultado = await db.query(
      `DELETE FROM media_publicacoes
       WHERE id = $1 AND escola_id = $2
       RETURNING imagem_url`,
      [id, req.mediaEscolaId]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Publicação não encontrada.' });
    await removerFicheiroLocal(resultado.rows[0].imagem_url);
    return res.json({ success: true, message: 'Publicação removida.' });
  } catch (error) {
    console.error('Erro ao remover publicação:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível remover a publicação.' });
  }
});

router.post('/fotos', verificarAutenticacao, verificarDirecao, receberFicheiro, async (req, res) => {
  const { titulo, categoria = '', imagem_url: imagemUrl = '' } = req.body || {};
  if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180
    || typeof categoria !== 'string' || categoria.trim().length > 80) {
    return res.status(400).json({ success: false, message: 'Título ou categoria da foto inválidos.' });
  }
  if (req.file && !ficheiroValido(req.file, new Set(['image/jpeg', 'image/png', 'image/webp']))) {
    return res.status(400).json({ success: false, message: 'Envie uma imagem JPEG, PNG ou WebP válida.' });
  }
  if (!req.file && !validarUrlPublica(imagemUrl)) {
    return res.status(400).json({ success: false, message: 'Envie uma imagem ou um URL HTTPS válido.' });
  }

  let ficheiro;
  try {
    if (req.file) ficheiro = await guardarFicheiro(req.file);
    const url = ficheiro?.url || imagemUrl.trim();
    const resultado = await db.query(
      `INSERT INTO media_fotos (escola_id, titulo, categoria, imagem_url, criado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, titulo, categoria, imagem_url, criado_em`,
      [req.mediaEscolaId, titulo.trim(), categoria.trim(), url, req.user.id]
    );
    return res.status(201).json({ success: true, data: resultado.rows[0], message: 'Foto adicionada ao álbum.' });
  } catch (error) {
    if (ficheiro) await removerFicheiroLocal(ficheiro.url).catch((cleanupError) => {
      console.error('Erro ao remover foto não registada:', cleanupError);
    });
    console.error('Erro ao adicionar foto ao álbum:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível adicionar a foto.' });
  }
});

router.delete('/fotos/:id', verificarAutenticacao, verificarDirecao, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id || '')) return res.status(400).json({ success: false, message: 'Foto inválida.' });
  try {
    const resultado = await db.query(
      `DELETE FROM media_fotos WHERE id = $1 AND escola_id = $2 RETURNING imagem_url`,
      [req.params.id, req.mediaEscolaId]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Foto não encontrada.' });
    await removerFicheiroLocal(resultado.rows[0].imagem_url);
    return res.json({ success: true, message: 'Foto removida do álbum.' });
  } catch (error) {
    console.error('Erro ao remover foto do álbum:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível remover a foto.' });
  }
});

router.put('/admissoes/:matriculaId/publicacao', verificarAutenticacao, verificarDirecao, async (req, res) => {
  const matriculaId = req.params.matriculaId;
  const publicar = req.body?.publicada;
  if (!UUID_PATTERN.test(matriculaId || '') || typeof publicar !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Matrícula ou estado de publicação inválido.' });
  }
  try {
    if (publicar) {
      const resultado = await db.query(
        `INSERT INTO media_matriculas_publicadas (escola_id, matricula_id, publicado_por)
         SELECT m.escola_id, m.id, $3
         FROM matriculas m
         JOIN matriculas_decisoes_direcao d ON d.matricula_id = m.id AND d.decisao = 'aprovado'
         WHERE m.id = $1 AND m.escola_id = $2 AND m.estado = 'ativa'
         ON CONFLICT (escola_id, matricula_id) DO NOTHING
         RETURNING matricula_id`,
        [matriculaId, req.mediaEscolaId, req.user.id]
      );
      if (!resultado.rowCount) {
        const existe = await db.query(
          `SELECT 1 FROM media_matriculas_publicadas
           WHERE escola_id = $1 AND matricula_id = $2`,
          [req.mediaEscolaId, matriculaId]
        );
        if (!existe.rowCount) return res.status(404).json({ success: false, message: 'Aluno admitido não encontrado.' });
      }
    } else {
      await db.query(
        `DELETE FROM media_matriculas_publicadas
         WHERE escola_id = $1 AND matricula_id = $2`,
        [req.mediaEscolaId, matriculaId]
      );
    }
    return res.json({ success: true, message: publicar ? 'Referência publicada no portal.' : 'Referência retirada do portal.' });
  } catch (error) {
    console.error('Erro ao alterar publicação de admissão:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar a lista pública.' });
  }
});

router.patch('/comentarios/:id', verificarAutenticacao, verificarDirecao, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body || {};
  if (!UUID_PATTERN.test(id || '') || !['aprovado', 'rejeitado'].includes(estado)) {
    return res.status(400).json({ success: false, message: 'Comentário ou decisão inválidos.' });
  }
  try {
    const resultado = await db.query(
      `UPDATE media_comentarios
       SET estado = $1, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $2 AND escola_id = $3
       RETURNING id`,
      [estado, id, req.mediaEscolaId]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Comentário não encontrado.' });
    return res.json({ success: true, message: estado === 'aprovado' ? 'Comentário aprovado.' : 'Comentário rejeitado.' });
  } catch (error) {
    console.error('Erro ao moderar comentário:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível moderar o comentário.' });
  }
});

router.delete('/comentarios/:id', verificarAutenticacao, verificarDirecao, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id || '')) return res.status(400).json({ success: false, message: 'Comentário inválido.' });
  try {
    const resultado = await db.query(
      `DELETE FROM media_comentarios WHERE id = $1 AND escola_id = $2 RETURNING id`,
      [req.params.id, req.mediaEscolaId]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Comentário não encontrado.' });
    return res.json({ success: true, message: 'Comentário removido.' });
  } catch (error) {
    console.error('Erro ao remover comentário:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível remover o comentário.' });
  }
});

router.post('/livros', verificarAutenticacao, verificarDirecao, receberFicheiro, async (req, res) => {
  const { titulo, autor = '', descricao = '', ficheiro_url: ficheiroUrl = '' } = req.body || {};
  if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180
    || typeof autor !== 'string' || autor.trim().length > 180
    || typeof descricao !== 'string' || descricao.trim().length > 1200) {
    return res.status(400).json({ success: false, message: 'Título, autor ou descrição do livro inválidos.' });
  }
  if (req.file && !ficheiroValido(req.file, new Set(['application/pdf']))) {
    return res.status(400).json({ success: false, message: 'Envie um documento PDF válido.' });
  }
  if (!req.file && ficheiroUrl && !validarUrlPublica(ficheiroUrl)) {
    return res.status(400).json({ success: false, message: 'O endereço do livro deve ser um URL HTTPS válido.' });
  }

  let ficheiro;
  try {
    if (req.file) ficheiro = await guardarFicheiro(req.file);
    const url = ficheiro?.url || ficheiroUrl.trim();
    const resultado = await db.query(
      `INSERT INTO media_livros (escola_id, titulo, autor, descricao, ficheiro_url, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, titulo, autor, descricao, ficheiro_url, criado_em`,
      [req.mediaEscolaId, titulo.trim(), autor.trim(), descricao.trim(), url, req.user.id]
    );
    return res.status(201).json({ success: true, data: resultado.rows[0], message: 'Livro adicionado à biblioteca.' });
  } catch (error) {
    if (ficheiro) await removerFicheiroLocal(ficheiro.url).catch((cleanupError) => {
      console.error('Erro ao remover livro não registado:', cleanupError);
    });
    console.error('Erro ao adicionar livro à biblioteca:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível adicionar o livro.' });
  }
});

router.delete('/livros/:id', verificarAutenticacao, verificarDirecao, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id || '')) return res.status(400).json({ success: false, message: 'Livro inválido.' });
  try {
    const resultado = await db.query(
      `DELETE FROM media_livros WHERE id = $1 AND escola_id = $2 RETURNING ficheiro_url`,
      [req.params.id, req.mediaEscolaId]
    );
    if (!resultado.rowCount) return res.status(404).json({ success: false, message: 'Livro não encontrado.' });
    await removerFicheiroLocal(resultado.rows[0].ficheiro_url);
    return res.json({ success: true, message: 'Livro removido da biblioteca.' });
  } catch (error) {
    console.error('Erro ao remover livro da biblioteca:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível remover o livro.' });
  }
});

module.exports = router;
