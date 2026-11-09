const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');
const { hashPassword } = require('../services/authService');
const { registarAuditoria } = require('../services/ownerAuditService');
const xlsx = require('xlsx');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Formato inválido. Envie uma imagem JPEG, PNG ou WebP.'));
    }
    return callback(null, true);
  }
});

function gerarSenhaPorTelefone(telefone) {
  if (!telefone) return '1234567';
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length >= 7) {
    return digitos.slice(-7);
  }
  return digitos.length > 0 ? digitos.padEnd(7, '0') : '1234567';
}

const MAX_LOGO_BYTES = 30 * 1024;
const MAX_LOGO_PIXELS = 20_000_000;

function receberLogo(req, res, next) {
  uploadLogo.single('logo')(req, res, (error) => {
    if (!error) return next();
    const limite = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(limite ? 413 : 400).json({
      success: false,
      message: limite
        ? 'A imagem excede o limite de envio de 5 MB.'
        : error.message || 'Não foi possível receber a imagem.'
    });
  });
}

router.post('/escolas/logo', verificarAutenticacao, receberLogo, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Selecione uma imagem JPEG, PNG ou WebP.' });
  }

  try {
    const imagem = sharp(req.file.buffer, { limitInputPixels: MAX_LOGO_PIXELS });
    const metadata = await imagem.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return res.status(400).json({ success: false, message: 'O conteúdo enviado não é uma imagem JPEG, PNG ou WebP válida.' });
    }

    for (const dimensao of [512, 384, 288, 216, 160]) {
      const buffer = await sharp(req.file.buffer, { limitInputPixels: MAX_LOGO_PIXELS })
        .rotate()
        .resize({ width: dimensao, height: dimensao, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 3 })
        .toBuffer();

      if (buffer.length <= MAX_LOGO_BYTES) {
        return res.json({
          success: true,
          data: { logo_url: `data:image/webp;base64,${buffer.toString('base64')}` }
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: 'Não foi possível reduzir esta imagem para o limite de 30 KB. Escolha um logótipo mais simples.'
    });
  } catch (error) {
    console.error('[ACCOUNTS] Erro ao processar logótipo:', error);
    return res.status(400).json({
      success: false,
      message: 'A imagem está inválida ou não pôde ser processada. Envie um JPEG, PNG ou WebP válido.'
    });
  }
});

function validarLogoUrl(logoUrl) {
  if (logoUrl == null || logoUrl === '') return { valido: true, valor: null };
  if (typeof logoUrl !== 'string') return { valido: false };
  if (logoUrl.startsWith('data:')) {
    const match = logoUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return { valido: false };
    const imagem = Buffer.from(match[2], 'base64');
    if (imagem.length > MAX_LOGO_BYTES || imagem.toString('base64') !== match[2]) {
      return { valido: false };
    }
    const assinaturaValida = match[1] === 'jpeg' ? imagem[0] === 0xff && imagem[1] === 0xd8 && imagem[2] === 0xff : match[1] === 'png' ? imagem.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : imagem.toString('ascii', 0, 4) === 'RIFF' && imagem.toString('ascii', 8, 12) === 'WEBP';
    if (!assinaturaValida) return { valido: false };
    return { valido: true, valor: logoUrl };
  }
  if (logoUrl.length > 2048) return { valido: false };
  if (logoUrl.startsWith('/') && !logoUrl.startsWith('//')) {
    return { valido: true, valor: logoUrl };
  }
  try {
    const url = new URL(logoUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return { valido: false };
  } catch {
    return { valido: false };
  }
  return { valido: true, valor: logoUrl };
}

const NIVEIS_ENSINO_PADRAO = [
  { nome: 'Jardim / Infantil', codigo: 1, gratuitidade: 'nao_definida' },
  { nome: 'Ensino Básico (1º Ciclo)', codigo: 2, gratuitidade: 'gratuito' },
  { nome: 'Ensino Básico (2º Ciclo)', codigo: 3, gratuitidade: 'gratuito' },
  { nome: 'Ensino Básico (3º Ciclo)', codigo: 4, gratuitidade: 'tendencialmente_gratuito' },
  { nome: 'Ensino Secundário / Liceu', codigo: 5, gratuitidade: 'nao_definida' },
  { nome: 'Formação Técnico-Profissional', codigo: 6, gratuitidade: 'nao_definida' },
  { nome: 'Ensino Superior / Universidade', codigo: 7, gratuitidade: 'nao_definida' }
];

router.get('/public/escola/:subdominio', async (req, res) => {
  const subdominio = String(req.params.subdominio || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdominio)) {
    return res.status(400).json({ success: false, message: 'Subdomínio inválido.' });
  }

  try {
    const resultado = await db.query(
      `SELECT e.id, e.nome, e.sigla, e.subdominio, e.logo_url, e.categoria,
              e.local, e.sector, e.endereco, e.regime_periodo, e.cor_primaria,
              e.motto, e.visao, e.missao, e.valor,
              COALESCE((
                SELECT json_agg(
                  json_build_object('id', ne.id, 'nome', ne.nome)
                  ORDER BY ne.codigo_academico, ne.nome
                )
                FROM escolas_niveis en
                JOIN niveis_ensino ne ON ne.id = en.nivel_id
                WHERE en.escola_id = e.id
              ), '[]'::json) AS niveis_ensino
       FROM escolas e
       WHERE LOWER(TRIM(e.subdominio)) = $1
         AND e.status_verificacao IN ('ativo', 'verified')
       LIMIT 1`,
      [subdominio]
    );

    if (!resultado.rowCount) {
      return res.status(404).json({ success: false, message: 'Escola não encontrada ou inativa.' });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: resultado.rows[0] });
  } catch (error) {
    console.error('[ACCOUNTS] Erro ao carregar portal público da escola:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o portal da escola.' });
  }
});

router.get('/niveis-ensino', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE niveis_ensino IN SHARE ROW EXCLUSIVE MODE');
    let resultado = await client.query(
      `SELECT id, nome, codigo_academico, politica_gratuidade
       FROM niveis_ensino
       ORDER BY codigo_academico, nome`
    );
    if (resultado.rows.length === 0) {
      for (const nivel of NIVEIS_ENSINO_PADRAO) {
        await client.query(
          `INSERT INTO niveis_ensino
             (id, nome, codigo_academico, politica_gratuidade)
           VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), nivel.nome, nivel.codigo, nivel.gratuitidade]
        );
      }
      resultado = await client.query(
        `SELECT id, nome, codigo_academico, politica_gratuidade
         FROM niveis_ensino
         ORDER BY codigo_academico, nome`
      );
    }
    await client.query('COMMIT');
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ACCOUNTS] listar níveis de ensino', error);
    return res.status(500).json({ success: false, message: 'Erro ao listar níveis de ensino.' });
  } finally {
    client.release();
  }
});


// 1) CRIAR ESCOLA E CONTA DE DIREÇÃO AUTOMÁTICA (Gera login_id perfeitamente)
router.post('/escolas', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    const { 
      nome_escola, 
      sigla, 
      categoria, 
      niveis_ids, 
      local, 
      sector, 
      endereco, 
      regime_periodo, 
      nif, 
      licenca_men, 
      subdominio, 
      logo_url, 
      cor_primaria, 
      motto, 
      visao, 
      missao,
      valor,
      aceitou_termos, 
      diretor_nome, 
      diretor_contacto, 
      diretor_email 
    } = req.body || {};

    const logoValidado = validarLogoUrl(logo_url);
    if (!logoValidado.valido) {
      return res.status(400).json({ success: false, message: 'A foto deve ser JPEG, PNG ou WebP e ter no máximo 30 KB.' });
    }
    if (!nome_escola?.trim() || !sigla?.trim()) {
      return res.status(400).json({ success: false, message: "O nome e a sigla da escola são obrigatórios." });
    }
    const siglaLogin = sigla.trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
    if (siglaLogin.length !== 2) {
      return res.status(400).json({ success: false, message: "A sigla da escola deve conter pelo menos duas letras para gerar o login." });
    }
    if (![1, 2, 3].includes(Number(categoria))) {
      return res.status(400).json({ success: false, message: "Selecione um tipo de gestão válido." });
    }
    if (aceitou_termos !== true) {
      return res.status(400).json({ success: false, message: "É necessário confirmar os dados e aceitar os termos." });
    }
    if (!Array.isArray(niveis_ids) || niveis_ids.some((id) => !UUID_PATTERN.test(String(id)))) {
      return res.status(400).json({ success: false, message: "A lista de níveis de ensino é inválida." });
    }
    if (visao !== undefined && visao !== null && typeof visao !== 'string') {
      return res.status(400).json({ success: false, message: "A visão da escola deve ser um texto válido." });
    }
    const palavrasVisao = typeof visao === 'string' ? visao.trim().split(/\s+/).filter(Boolean).length : 0;
    if (palavrasVisao > 500) {
      return res.status(400).json({ success: false, message: "A visão da escola não pode ultrapassar 500 palavras." });
    }
    if ([missao, valor].some((campo) => campo !== undefined && campo !== null && (typeof campo !== 'string' || campo.trim().length > 255))) {
      return res.status(400).json({ success: false, message: "Missão e valor devem ter no máximo 255 caracteres." });
    }

    const ids = [...new Set(niveis_ids.map(String))];
    await client.query("BEGIN");
    await client.query('SELECT pg_advisory_xact_lock($1)', [7462301]);

    const niveisEncontrados = await client.query(
      `SELECT id, nome, codigo_academico FROM niveis_ensino WHERE id::text = ANY($1::text[])`,
      [ids]
    );
    if (niveisEncontrados.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Um ou mais níveis de ensino não foram encontrados." });
    }
    const codigoAcademico = String(Math.max(
      0,
      ...niveisEncontrados.rows.map((nivel) => Number(nivel.codigo_academico) || 0)
    ));

    // Inserir Escola
    const escolaResult = await client.query(
      `INSERT INTO escolas ( 
        nome, sigla, subdominio, nif, licenca_men, logo_url, categoria, local, sector, endereco, regime_periodo, cor_primaria, motto, visao, missao, valor, status_verificacao 
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'ativo') 
      RETURNING id, nome, sigla, subdominio`,
      [ 
        nome_escola.trim(), 
        sigla.trim(), 
        subdominio || null, 
        nif || null, 
        licenca_men || null, 
        logoValidado.valor, 
        categoria ?? 1, 
        local || 'SAB', 
        sector || null, 
        endereco || null, 
        regime_periodo || 'Regular', 
        cor_primaria || "#0284c7", 
        motto || null, 
        visao?.trim() || null,
        missao?.trim() || null,
        valor?.trim() || null,
      ]
    );
    const escola = escolaResult.rows[0];

    for (const nivelId of ids) {
      await client.query(
        `INSERT INTO escolas_niveis (escola_id, nivel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [escola.id, nivelId]
      );
    }

    // Gerar Login ID da Direção
    const countRes = await client.query(`SELECT COUNT(*) as total FROM escolas`);
    const seqId = String(parseInt(countRes.rows[0].total, 10)).padStart(3, '0');
    const categoriaNumero = Number(categoria);
    const catCode = categoriaNumero === 2 ? '0' : categoriaNumero === 1 ? '1' : '2';
    const loginIdDirecao = `S${siglaLogin}${catCode}${codigoAcademico}${seqId}`;
    
    // Senha baseada nos últimos 7 dígitos do telefone
    const passwordTemporaria = gerarSenhaPorTelefone(diretor_contacto);
    const hash = await hashPassword(passwordTemporaria);

    const nomeDiretor = diretor_nome?.trim() || `Direção ${nome_escola.trim()}`;
    const emailDiretor = diretor_email?.trim() || `direcao.${sigla.toLowerCase()}@futurese.gw`;

    const userRes = await client.query(
      `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta) 
       VALUES ($1, $2, $3, $4, $5, true, 'normal') RETURNING id`,
      [nomeDiretor, emailDiretor, diretor_contacto || null, loginIdDirecao, hash]
    );
    const userId = userRes.rows[0].id;

    const assocRes = await client.query(
      `INSERT INTO associacoes_escola (escola_id, utilizador_id, status) VALUES ($1, $2, 'ativo') RETURNING id`,
      [escola.id, userId]
    );
    const associacaoId = assocRes.rows[0].id;

    await client.query(
      `INSERT INTO papeis_utilizador (associacao_id, papel) VALUES ($1, 'direcao') ON CONFLICT DO NOTHING`,
      [associacaoId]
    ).catch(() => {});

    await client.query("COMMIT");
    await registarAuditoria({
      actorId: req.user?.id,
      escolaId: escola.id,
      acao: 'escola_criada',
      entidade: 'escola',
      entidadeId: escola.id,
      detalhes: { nome: escola.nome, sigla: escola.sigla },
      ipAddress: req.ip || req.socket?.remoteAddress || null
    });
    return res.status(201).json({ 
      success: true, 
      message: "Escola e conta da Direção criadas com sucesso.", 
      data: { 
        escola, 
        direcao_gerada: { 
          nome: nomeDiretor, 
          login_id: loginIdDirecao, 
          password_temporaria: passwordTemporaria, 
          email: emailDiretor 
        } 
      }, 
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro ao criar escola:", error);
    return res.status(500).json({ success: false, message: "Não foi possível criar a escola no banco de dados." });
  } finally {
    client.release();
  }
});

// 2) ATIVAR / DESATIVAR ESCOLA
router.patch('/escolas/:id/status', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const { status_verificacao } = req.body || {};
    if (!status_verificacao) return res.status(400).json({ success: false, message: 'status_verificacao obrigatório.' });
    
    const r = await db.query('UPDATE escolas SET status_verificacao = $1 WHERE id = $2 RETURNING *', [status_verificacao, id]);
    if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Escola não encontrada.' });
    
    return res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    console.error('[ACCOUNTS] status escola', e);
    return res.status(500).json({ success: false, message: 'Erro ao alterar estado.' });
  }
});

// 3) BUSCAR UMA ESCOLA
router.get('/escolas/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const r = await db.query(
      `SELECT e.*, 
              ARRAY(SELECT en.nivel_id FROM escolas_niveis en WHERE en.escola_id = e.id) AS niveis_ids, 
              direcao.nome AS diretor_nome, 
              direcao.email AS diretor_email, 
              direcao.telefone AS diretor_contacto 
       FROM escolas e 
       LEFT JOIN LATERAL ( 
         SELECT u.nome, u.email, u.telefone 
         FROM associacoes_escola ae 
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = 'direcao' 
         JOIN utilizadores u ON u.id = ae.utilizador_id 
         WHERE ae.escola_id = e.id AND ae.status = 'ativo' 
         ORDER BY ae.id DESC LIMIT 1 
       ) direcao ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT m.aluno_id)::integer AS total_alunos
         FROM matriculas m
         WHERE m.escola_id = e.id AND m.estado = 'ativa'
       ) alunos ON true
       WHERE e.id = $1`,
      [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Escola não encontrada.' });
    
    return res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    console.error('[ACCOUNTS] get escola', e);
    return res.status(500).json({ success: false, message: 'Erro ao buscar escola.' });
  }
});

// 4) BUSCAR TODAS AS ESCOLAS
router.get('/escolas', verificarAutenticacao, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT e.id, e.nome, e.sigla, e.subdominio, e.nif, e.licenca_men, e.categoria, e.local, e.sector, e.endereco, e.regime_periodo, e.cor_primaria, e.motto, e.visao, e.missao, e.valor, e.status_verificacao,
              alunos.total_alunos,
              ARRAY(SELECT en.nivel_id FROM escolas_niveis en WHERE en.escola_id = e.id) AS niveis_ids, 
              direcao.nome AS diretor_nome, 
              direcao.email AS diretor_email, 
              direcao.telefone AS diretor_contacto 
       FROM escolas e 
       LEFT JOIN LATERAL ( 
         SELECT u.nome, u.email, u.telefone 
         FROM associacoes_escola ae 
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = 'direcao' 
         JOIN utilizadores u ON u.id = ae.utilizador_id 
         WHERE ae.escola_id = e.id AND ae.status = 'ativo' 
         ORDER BY ae.id DESC LIMIT 1 
       ) direcao ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT m.aluno_id)::integer AS total_alunos
         FROM matriculas m
         WHERE m.escola_id = e.id AND m.estado = 'ativa'
       ) alunos ON true
       ORDER BY e.nome`
    );
    return res.json({ success: true, data: r.rows });
  } catch (e) {
    console.error('[ACCOUNTS] listar escolas', e);
    return res.status(500).json({ success: false, message: 'Erro ao listar escolas.' });
  }
});

// 5) EDITAR ESCOLA (Corrigido e blindado)
router.put('/escolas/:id', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    if (req.user?.isOwner !== true) {
      return res.status(403).json({ success: false, message: 'Apenas o Owner pode editar os dados institucionais e o subdomínio da escola.' });
    }

    const { id } = req.params;
    const { 
      nome, 
      sigla, 
      endereco, 
      nif, 
      logo_url, 
      status_verificacao, 
      subdominio, 
      licenca_men, 
      categoria, 
      local, 
      sector, 
      regime_periodo, 
      cor_primaria, 
      motto, 
      visao, 
      missao,
      valor,
      diretor_nome, 
      diretor_contacto, 
      diretor_email, 
      remover_logo, 
      niveis_ids 
    } = req.body || {};

    if (subdominio !== undefined && subdominio !== null && typeof subdominio !== 'string') {
      return res.status(400).json({ success: false, message: 'O subdomínio deve ser um texto válido.' });
    }
    const subdominioNormalizado = typeof subdominio === 'string'
      ? subdominio.trim().toLowerCase() || null
      : null;
    if (subdominioNormalizado && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdominioNormalizado)) {
      return res.status(400).json({
        success: false,
        message: 'O subdomínio deve ter 1 a 63 caracteres: letras minúsculas, números e hífen, sem hífen no início ou no fim.'
      });
    }

    const logoValidado = validarLogoUrl(logo_url);
    if (!logoValidado.valido) {
      return res.status(400).json({ success: false, message: 'A foto deve ser JPEG, PNG ou WebP e ter no máximo 30 KB.' });
    }
    if (visao !== undefined && visao !== null && typeof visao !== 'string') {
      return res.status(400).json({ success: false, message: "A visão da escola deve ser um texto válido." });
    }
    const palavrasVisao = typeof visao === 'string' ? visao.trim().split(/\s+/).filter(Boolean).length : 0;
    if (palavrasVisao > 500) {
      return res.status(400).json({ success: false, message: "A visão da escola não pode ultrapassar 500 palavras." });
    }
    if ([missao, valor].some((campo) => campo !== undefined && campo !== null && (typeof campo !== 'string' || campo.trim().length > 255))) {
      return res.status(400).json({ success: false, message: "Missão e valor devem ter no máximo 255 caracteres." });
    }
    if (niveis_ids !== undefined && (!Array.isArray(niveis_ids) || niveis_ids.length === 0)) {
      return res.status(400).json({ success: false, message: 'Selecione pelo menos um nível de ensino.' });
    }

    client = await db.connect();
    await client.query('BEGIN');

    if (subdominioNormalizado) {
      const subdominioExistente = await client.query(
        `SELECT 1 FROM escolas
         WHERE LOWER(TRIM(subdominio)) = $1 AND id <> $2
         LIMIT 1`,
        [subdominioNormalizado, id]
      );
      if (subdominioExistente.rowCount) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ success: false, message: 'Este subdomínio já está associado a outra escola.' });
      }
    }

    if (Array.isArray(niveis_ids)) {
      const idsNiveis = [...new Set(niveis_ids.map(String))];
      const niveisEncontrados = await client.query(
        'SELECT id FROM niveis_ensino WHERE id::text = ANY($1::text[])',
        [idsNiveis]
      );
      if (niveisEncontrados.rows.length !== idsNiveis.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ success: false, message: 'Um ou mais níveis de ensino não foram encontrados.' });
      }
    }

    const r = await client.query(
      `UPDATE escolas SET 
        nome = COALESCE($1, nome), 
        sigla = COALESCE($2, sigla), 
        endereco = COALESCE($3, endereco), 
        nif = COALESCE($4, nif), 
        logo_url = CASE WHEN $17 THEN NULL ELSE COALESCE($5, logo_url) END, 
        status_verificacao = COALESCE($6, status_verificacao), 
        subdominio = CASE WHEN $20 THEN $7 ELSE subdominio END, 
        licenca_men = COALESCE($8, licenca_men), 
        categoria = COALESCE($9, categoria), 
        local = COALESCE($10, local), 
        sector = COALESCE($11, sector), 
        regime_periodo = COALESCE($12, regime_periodo), 
        cor_primaria = COALESCE($13, cor_primaria), 
        motto = COALESCE($14, motto), 
        visao = COALESCE($15, visao),
        missao = COALESCE($18, missao),
        valor = COALESCE($19, valor)
       WHERE id = $16 RETURNING *`,
      [
        nome || null, 
        sigla || null, 
        endereco || null, 
        nif || null, 
        logoValidado.valor, 
        status_verificacao || null, 
        subdominio === undefined ? null : subdominioNormalizado, 
        licenca_men || null, 
        categoria ?? null, 
        local || null, 
        sector || null, 
        regime_periodo || null, 
        cor_primaria || null, 
        motto || null, 
        visao || null, 
        id, 
        remover_logo === true,
        missao === undefined ? null : missao?.trim() || null,
        valor === undefined ? null : valor?.trim() || null,
        subdominio !== undefined
      ]
    );

    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ success: false, message: 'Escola não encontrada.' });
    }

    if (Array.isArray(niveis_ids)) {
      const idsNiveis = [...new Set(niveis_ids.map(String))];
      await client.query('DELETE FROM escolas_niveis WHERE escola_id = $1', [id]);
      for (const nivelId of idsNiveis) {
        await client.query(
          'INSERT INTO escolas_niveis (escola_id, nivel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, nivelId]
        );
      }
    }

    if (diretor_nome || diretor_email || diretor_contacto) {
      await client.query(
        `UPDATE utilizadores u SET 
           nome = COALESCE($1, u.nome), 
           email = COALESCE($2, u.email), 
           telefone = COALESCE($3, u.telefone) 
         FROM associacoes_escola ae 
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = 'direcao' 
         WHERE ae.utilizador_id = u.id AND ae.escola_id = $4 AND ae.status = 'ativo'`,
        [diretor_nome || null, diretor_email || null, diretor_contacto || null, id]
      );
    }

    await client.query('COMMIT');
    client.release();
    await registarAuditoria({
      actorId: req.user?.id,
      escolaId: id,
      acao: 'escola_atualizada',
      entidade: 'escola',
      entidadeId: id,
      detalhes: { campos_alterados: ['dados_institucionais', 'direcao', 'niveis'] },
      ipAddress: req.ip || req.socket?.remoteAddress || null
    });
    return res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    console.error('[ACCOUNTS] editar escola', e);
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Este subdomínio já está associado a outra escola.' });
    }
    return res.status(500).json({ success: false, message: 'Erro ao editar escola.' });
  }
});




// =========================================================================
// 1) CRIAR FUNCIONÁRIO (Individual)
// Cria o utilizador, associa à escola e define o papel (professor, secretaria, tesouraria)
// =========================================================================
router.post('/funcionarios', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    const { 
      escola_id, 
      nome, 
      email, 
      telefone, 
      papel, // 'professor', 'secretaria', 'tesouraria'
      nivel_id // Opcional: caso pertença a um nível específico
    } = req.body || {};

    if (!escola_id || !nome || !papel) {
      return res.status(400).json({ success: false, message: "Escola, nome e papel são obrigatórios." });
    }

    const papeisPermitidos = ['professor', 'secretaria', 'tesouraria', 'direcao'];
    if (!papeisPermitidos.includes(papel.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Papel inválido. Escolha entre professor, secretaria ou tesouraria." });
    }

    await client.query("BEGIN");

    // A. Verificar se a escola existe
    const escolaCheck = await client.query(`SELECT sigla FROM escolas WHERE id = $1`, [escola_id]);
    if (escolaCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Escola não encontrada." });
    }
    const siglaEscola = escolaCheck.rows[0].sigla || 'ESC';

    // B. Gerar ID de login único para o funcionário (Ex: PROF-SIGLA-001)
    const countRes = await client.query(`SELECT COUNT(*) as total FROM utilizadores`);
    const seqId = String(parseInt(countRes.rows[0].total, 10) + 1).padStart(3, '0');
    const prefixoPapel = papel.substring(0, 3).toUpperCase();
    const loginId = `${prefixoPapel}-${siglaEscola}-${seqId}`;

    const passwordTemporaria = randomPass();
    const hashedPassword = await hashPassword(passwordTemporaria);
    const emailFinal = email || `${loginId.toLowerCase()}@futurese.gw`;

    // C. Inserir na tabela utilizadores
    const userRes = await client.query(
      `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta) 
       VALUES ($1, $2, $3, $4, $5, true, 'normal') RETURNING id, nome, email, login_id`,
      [nome.trim(), emailFinal, telefone || null, loginId, hashedPassword]
    );
    const utilizador = userRes.rows[0];

    // D. Criar associação na tabela associacoes_escola
    const assocRes = await client.query(
      `INSERT INTO associacoes_escola (escola_id, utilizador_id, status) 
       VALUES ($1, $2, 'ativo') RETURNING id`,
      [escola_id, utilizador.id]
    );
    const associacaoId = assocRes.rows[0].id;

    // E. Atribuir o papel na tabela papeis_utilizador
    await client.query(
      `INSERT INTO papeis_utilizador (associacao_id, papel) VALUES ($1, $2)`,
      [associacaoId, papel.toLowerCase()]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Funcionário registado com sucesso.",
      data: {
        utilizador_id: utilizador.id,
        nome: utilizador.nome,
        login_id: utilizador.login_id,
        email: utilizador.email,
        papel: papel.toLowerCase(),
        password_temporaria: passwordTemporaria // Importante para entregar as credenciais iniciais
      }
    });

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro ao criar funcionário:", error);
    return res.status(500).json({ success: false, message: "Não foi possível criar o funcionário." });
  } finally {
    client.release();
  }
});

// =========================================================================
// 2) BUSCAR TODOS OS FUNCIONÁRIOS DE UMA ESCOLA
// =========================================================================
router.get('/funcionarios', verificarAutenticacao, async (req, res) => {
  try {
    const { escola_id, papel } = req.query;
    if (!escola_id) {
      return res.status(400).json({ success: false, message: "O parâmetro escola_id é obrigatório." });
    }

    let query = `
      SELECT 
        u.id as utilizador_id,
        u.nome,
        u.email,
        u.telefone,
        u.login_id,
        u.status_ativo,
        ae.id as associacao_id,
        ae.escola_id,
        p.papel,
        u.criado_em
      FROM associacoes_escola ae
      JOIN utilizadores u ON ae.utilizador_id = u.id
      JOIN papeis_utilizador p ON p.associacao_id = ae.id
      WHERE ae.escola_id = $1
    `;
    const params = [escola_id];

    if (papel) {
      query += ` AND p.papel = $2`;
      params.push(papel.toLowerCase());
    }

    query += ` ORDER BY u.nome ASC`;

    const result = await db.query(query, params);
    return res.json({ success: true, data: result.rows });

  } catch (error) {
    console.error("Erro ao listar funcionários:", error);
    return res.status(500).json({ success: false, message: "Erro ao buscar funcionários." });
  }
});

// =========================================================================
// 3) BUSCAR UM FUNCIONÁRIO ESPECÍFICO
// =========================================================================
router.get('/funcionarios/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const { escola_id } = req.query;
    if (!escola_id) {
      return res.status(400).json({ success: false, message: "O parâmetro escola_id é obrigatório." });
    }
    const query = `
      SELECT 
        u.id as utilizador_id,
        u.nome,
        u.email,
        u.telefone,
        u.login_id,
        u.status_ativo,
        ae.id as associacao_id,
        ae.escola_id,
        p.papel,
        u.criado_em
      FROM utilizadores u
      JOIN associacoes_escola ae ON ae.utilizador_id = u.id
      JOIN papeis_utilizador p ON p.associacao_id = ae.id
      WHERE u.id = $1 AND ae.escola_id = $2
    `;
    const result = await db.query(query, [id, escola_id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Funcionário não encontrado." });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Erro ao buscar funcionário:", error);
    return res.status(500).json({ success: false, message: "Erro ao buscar detalhes do funcionário." });
  }
});

// =========================================================================
// 4) EDITAR FUNCIONÁRIO
// =========================================================================
router.put('/funcionarios/:id', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    const { id } = req.params; // utilizador_id
    const { nome, email, telefone, papel, status_ativo, escola_id } = req.body || {};
    if (!escola_id) {
      return res.status(400).json({ success: false, message: "A escola do funcionário é obrigatória." });
    }
    if (papel !== undefined && (
      typeof papel !== 'string' ||
      !['secretaria', 'professor', 'tesouraria'].includes(papel.toLowerCase())
    )) {
      return res.status(400).json({ success: false, message: "Papel de funcionário inválido." });
    }

    await client.query("BEGIN");

    // Atualizar dados básicos do utilizador
    const updateRes = await client.query(
      `UPDATE utilizadores SET 
        nome = COALESCE($1, nome),
        email = COALESCE($2, email),
        telefone = COALESCE($3, telefone),
        status_ativo = COALESCE($4, status_ativo),
        atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $5
         AND EXISTS (
           SELECT 1 FROM associacoes_escola ae
           WHERE ae.utilizador_id = utilizadores.id AND ae.escola_id = $6
         )
       RETURNING id AS utilizador_id, nome, email, telefone, login_id, status_ativo, criado_em`,
      [nome ?? null, email ?? null, telefone ?? null, status_ativo, id, escola_id]
    );

    if (updateRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Funcionário não encontrado." });
    }

    // Se o papel foi alterado, atualizar na tabela papeis_utilizador
    if (papel) {
      const papelRes = await client.query(
        `UPDATE papeis_utilizador
         SET papel = $1
         WHERE associacao_id IN (
           SELECT id FROM associacoes_escola
           WHERE utilizador_id = $2 AND escola_id = $3
         )`,
        [papel.toLowerCase(), id, escola_id]
      );
      if (papelRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Associação do funcionário à escola não encontrada." });
      }
    }

    await client.query("COMMIT");
    return res.json({ success: true, message: "Funcionário atualizado com sucesso.", data: updateRes.rows[0] });

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro ao editar funcionário:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar funcionário." });
  } finally {
    client.release();
  }
});

// =========================================================================
// 5) IMPORTAR MÚLTIPLOS FUNCIONÁRIOS VIA EXCEL / JSON
// =========================================================================
router.post('/funcionarios/import', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    const { escola_id, funcionarios } = req.body; 
    // 'funcionarios' é um array de objetos: [{ nome, email, telefone, papel }]

    if (!escola_id || !Array.isArray(funcionarios) || funcionarios.length === 0) {
      return res.status(400).json({ success: false, message: "Dados inválidos para importação." });
    }

    await client.query("BEGIN");

    const escolaCheck = await client.query(`SELECT sigla FROM escolas WHERE id = $1`, [escola_id]);
    if (escolaCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Escola não encontrada." });
    }
    const siglaEscola = escolaCheck.rows[0].sigla || 'ESC';

    const resultadosImportados = [];

    for (let f of funcionarios) {
      const nome = f.nome;
      const email = f.email || null;
      const telefone = f.telefone || null;
      const papel = (f.papel || 'professor').toLowerCase();

      if (!nome) continue;

      const countRes = await client.query(`SELECT COUNT(*) as total FROM utilizadores`);
      const seqId = String(parseInt(countRes.rows[0].total, 10) + 1).padStart(3, '0');
      const prefixoPapel = papel.substring(0, 3).toUpperCase();
      const loginId = `${prefixoPapel}-${siglaEscola}-${seqId}`;

      const passwordTemporaria = randomPass();
      const hashedPassword = await hashPassword(passwordTemporaria);
      const emailFinal = email || `${loginId.toLowerCase()}@futurese.gw`;

      // Inserir Utilizador
      const userRes = await client.query(
        `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta) 
         VALUES ($1, $2, $3, $4, $5, true, 'normal') RETURNING id`,
        [nome.trim(), emailFinal, telefone, loginId, hashedPassword]
      );
      const userId = userRes.rows[0].id;

      // Criar Associação
      const assocRes = await client.query(
        `INSERT INTO associacoes_escola (escola_id, utilizador_id, status) VALUES ($1, $2, 'ativo') RETURNING id`,
        [escola_id, userId]
      );
      const associacaoId = assocRes.rows[0].id;

      // Atribuir Papel
      await client.query(
        `INSERT INTO papeis_utilizador (associacao_id, papel) VALUES ($1, $2)`,
        [associacaoId, papel]
      );

      resultadosImportados.push({ nome, login_id: loginId, papel });
    }

    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      message: `${resultadosImportados.length} funcionários importados com sucesso.`,
      data: resultadosImportados
    });

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro na importação em massa:", error);
    return res.status(500).json({ success: false, message: "Erro ao processar importação via Excel." });
  }
});

// =========================================================================
// 6) EXPORTAR FUNCIONÁRIOS PARA EXCEL (.XLSX)
// =========================================================================
router.get('/funcionarios/export/excel', verificarAutenticacao, async (req, res) => {
  try {
    const { escola_id } = req.query;
    if (!escola_id) {
      return res.status(400).json({ success: false, message: "O parâmetro escola_id é obrigatório." });
    }

    const query = `
      SELECT 
        u.nome as "Nome Completo",
        u.email as "Email",
        u.telefone as "Telefone",
        u.login_id as "ID de Acesso",
        p.papel as "Cargo / Papel",
        CASE WHEN u.status_ativo THEN 'Ativo' ELSE 'Inativo' END as "Estado",
        u.criado_em as "Data de Registo"
      FROM associacoes_escola ae
      JOIN utilizadores u ON ae.utilizador_id = u.id
      JOIN papeis_utilizador p ON p.associacao_id = ae.id
      WHERE ae.escola_id = $1
      ORDER BY u.nome ASC
    `;

    const result = await db.query(query, [escola_id]);

    // Criar folha de Excel usando a biblioteca 'xlsx'
    const worksheet = xlsx.utils.json_to_sheet(result.rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Funcionários");

    // Gerar buffer binário
    const excelBuffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Disposition', 'attachment; filename="funcionarios_escola.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(excelBuffer);

  } catch (error) {
    console.error("Erro ao exportar excel:", error);
    return res.status(500).json({ success: false, message: "Erro ao gerar ficheiro Excel." });
  }
});


module.exports = router;