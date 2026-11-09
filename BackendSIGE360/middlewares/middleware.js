const db = require('../config/db');
const { hashSessionToken } = require('../services/authService');
const { registarAtividadeApi } = require('../services/apiActivityService');

function normalizarPapel(papel) {
  if (!papel || typeof papel !== 'string') return '';
  return papel.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function verificarAutenticacao(req, res, next) {
  try {
    let token = null;

    if (!token && req.cookies && typeof req.cookies.session_token === 'string') {
      token = req.cookies.session_token.trim();
    }

    if (!token) { return res.status(401).json({ success: false, message: 'Autenticação necessária.' }); }

    if (!/^[a-f0-9]{64}$/i.test(token)) { return res.status(401).json({ success: false, message: 'Token inválido.' }); }

    const tokenHash = hashSessionToken(token);

    const resultado = await db.query(
      `SELECT
          s.id AS session_id,
          s.utilizador_id,
          s.expira_em,
          u.nome,
          u.login_id,
          u.email,
          u.status_ativo,
          u.tipo_conta
       FROM sessoes s
       JOIN utilizadores u ON u.id = s.utilizador_id
       WHERE s.refresh_token_hash = $1
         AND s.revogado IS NOT TRUE
         AND s.expira_em > $2
       LIMIT 1`,
      [tokenHash, Date.now()]
    );

    if (resultado.rows.length === 0) { return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' }); }

    const sessao = resultado.rows[0];

    if (sessao.status_ativo !== true) { return res.status(403).json({ success: false, message: 'Conta desativada.' }); }

    const isOwner = typeof sessao.tipo_conta === 'string' && sessao.tipo_conta.trim().toLowerCase() === 'owner';

    req.user = {
      id: sessao.utilizador_id,
      user_id: sessao.utilizador_id,
      nome: sessao.nome,
      login_id: sessao.login_id,
      email: sessao.email,
      tipo_conta: sessao.tipo_conta,
      isOwner
    };

    req.session = {
      id: sessao.session_id,
      expira_em: sessao.expira_em
    };

    try {
      const ativo = await db.query(
        `SELECT ca.associacao_id, ca.escola_id, ca.papel, ca.papel_norm, ca.ativo_desde, e.nome AS escola_nome, e.sigla AS escola_sigla, e.cor_primaria
         FROM conta_ativa ca
         LEFT JOIN escolas e ON e.id = ca.escola_id
         WHERE ca.sessao_id = $1
         LIMIT 1`,
        [sessao.session_id]
      );
      req.contaAtiva = ativo.rows[0] || null;
    } catch (e) {
      req.contaAtiva = null;
    }

    const caminhoAtividade = String(req.originalUrl || req.path || '')
      .split('?')[0]
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig, ':id');
    const jsonOriginal = res.json;
    res.json = function registarRespostaJson(body) {
      req.auditResponseBody = body;
      return jsonOriginal.call(this, body);
    };
    res.once('finish', () => {
      void registarAtividadeApi(req, res.statusCode, caminhoAtividade, req.auditResponseBody);
    });

    return next();
  } catch (error) {
    console.error('[MIDDLEWARE] Erro:', error);
    return res.status(500).json({ success: false, message: 'Erro interno de autenticação.' });
  }
}

module.exports = verificarAutenticacao;
module.exports.verificarAutenticacao = verificarAutenticacao;
module.exports.normalizarPapel = normalizarPapel;
