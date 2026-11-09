// ============================================================
// AUTH - FUTURE-SE (Autenticaçao Prote)
// ============================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { hashPassword, verifyPassword } = require('../services/authService');
const verificarAutenticacao = require('../middlewares/middleware');

function normalizarPapel(papel) {
  if (!papel || typeof papel !== 'string') return '';
  return papel.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const OWNER_LOGIN = process.env.OWNER_LOGIN;
const OWNER_PASS = process.env.OWNER_PASS;

async function criarSessaoSimples(res, req, utilizadorId, manter=false) {
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expira_em = Date.now() + (7 * 24 * 60 * 60 * 1000);
  const ip_address = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const user_agent = req.headers['user-agent'] || 'Desconhecido';

  await db.query(`INSERT INTO sessoes (id, utilizador_id, refresh_token_hash, ip_address, user_agent, expira_em, revogado)
     VALUES ($1,$2,$3,$4,$5,$6,false)`, [sessionId, utilizadorId, tokenHash, ip_address, user_agent, expira_em]
  );

  const isProduction = process.env.NODE_ENV === 'production';

  const cookieConfig = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
  }

  if (manter){ cookieConfig.maxAge = 7 * 24 * 60 * 60 * 1000; }
  res.cookie('session_token', rawToken, cookieConfig);
  return { sessionId };
}

async function buscarContextos(utilizadorId) {
  const q = `
    SELECT a.id AS associacao_id,
           a.escola_id,
           p.papel AS papel_nome,
           e.nome AS escola_nome,
           e.sigla AS escola_sigla,
           e.cor_primaria
    FROM associacoes_escola a
    JOIN papeis_utilizador p ON p.associacao_id = a.id
    LEFT JOIN escolas e ON e.id = a.escola_id
    WHERE a.utilizador_id = $1
      AND (a.status IS NULL OR a.status = 'ativo')
    ORDER BY a.criado_em ASC
  `;
  const r = await db.query(q, [utilizadorId]);
  return r.rows;
}

// 1) LOGIN - COM AUTO-CRIAÇÃO PERSISTENTE DO OWNER NO BANCO
router.post('/login', async (req, res) => {
  try {
    const { login_id, password, manter } = req.body || {};
    const pass = password;
    if (!pass) return res.status(400).json({ success: false, message: 'Login ou Senha Incorreto' });

    const ident = typeof (login_id) === 'string' ? (login_id).trim() : null;
    if (!ident) return res.status(400).json({ success: false, message: 'Entrar Login ou Senha' });

    const identLower = ident.toLowerCase();

    const rU = await db.query(
      `SELECT id, password_hash, status_ativo, tipo_conta FROM utilizadores WHERE LOWER(login_id) = $1 OR LOWER(email) = $1 LIMIT 1`, [identLower]
    );
    let user = rU.rows[0] || null;

    // 2. SE O OWNER NÃO EXISTIR NO BANCO DE DADOS (Ou foi removido), CRIA ELE AGORA DE FORMA DEFINITIVA
    if (!user && identLower === OWNER_LOGIN.toLowerCase()) {
      if (pass !== OWNER_PASS) return res.status(401).json({ success: false, message: 'Login ou Senha Incorreto' });
      try {
        const hash = await hashPassword(OWNER_PASS);
        const ins = await db.query( 
          `INSERT INTO utilizadores (nome, email, login_id, password_hash, status_ativo, tipo_conta)
           VALUES ($1, $2, $3, $4, true, 'owner')`,
          ['System Owner', 'owner@futurese.local', 'owner', hash]
        );
        user = ins.rows[0];
        console.log('[AUTH] Owner não existia ou foi removido. Criado com sucesso no banco de dados.');
      } catch (e) {
        console.error('[AUTH] Erro Crítico ao persistir o Owner no banco de dados:', e.message);
        return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
      }
    }

    // 3. VALIDAÇÕES DE SEGURANÇA BASEADAS NO UTILIZADOR ENCONTRADO/CRIADO
    if (!user) return res.status(401).json({ success: false, message: 'Login ou Senha Incorreto' });
    if (user.status_ativo === false) return res.status(403).json({ success: false, message: 'Utilizador inativo.' });

    // 4. VALIDAÇÃO DE SENHA (OWNER TEXTO LIMPO VS USUÁRIO HASH CRYPTO)
    if (user.tipo_conta === 'owner') {
      if (pass !== OWNER_PASS) return res.status(401).json({ success: false, message: 'Login ou Senha Incorreto' });
    } else {
      const okPass = await verifyPassword(pass, user.password_hash);
      if (!okPass) return res.status(401).json({ success: false, message: 'Login ou Senha Incorreto' });
    }

    // 5. REGRA DO OWNER: Cria sessão e entra direto, sem passar pelas validações de escola
    if (user.tipo_conta === 'owner') {
      const sess = await criarSessaoSimples(res, req, user.id, manter);
      return res.status(200).json({
        success: true, message: 'Login efetuado com sucesso.',
        data: { modo: 'owner', redirect: '/dashboard/owner', sessao_id: sess.sessionId }
      });
    }

    // 6. BUSCA DE CONTEXTOS PARA UTILIZADORES NORMAS
    const contextos = await buscarContextos(user.id);

    // REGRA 3: Se tiver login mas SEM NENHUMA CONTA, não entra no sistema
    if (contextos.length === 0) {
      return res.status(200).json({ success: false, message: 'Conta nao Encontrou, Contate o Administrador.' });
    }

    // REGRA 1: Se tiver apenas 1 conta, ENTRA DIRETO (Gera a sessão e ativa a conta no banco)
    if (contextos.length === 1) {
      const c = contextos[0];
      const papelNorm = normalizarPapel(c.papel_nome);

      const sess = await criarSessaoSimples(res, req, user.id);

      // Sincroniza a tabela conta_ativa para o middleware saber qual escola está a usar
      try {
        await db.query('DELETE FROM conta_ativa WHERE sessao_id = $1', [sess.sessionId]);
        await db.query(
          `INSERT INTO conta_ativa (sessao_id, utilizador_id, associacao_id, escola_id, papel, papel_norm)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sess.sessionId, user.id, c.associacao_id, c.escola_id, c.papel_nome, papelNorm]
        );
      } catch (e) {
        console.error('[AUTH] Erro ao sincronizar conta_ativa no login direto:', e.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Login efetuado com sucesso.',
        data: {
          modo: 'direto',
          redirect: `/dashboard/${papelNorm || c.papel_nome}`,
          sessao_id: sess.sessionId,
          conta_ativa: {
            papel: c.papel_nome,
            papel_norm: papelNorm,
            escola_id: c.escola_id,
            escola_nome: c.escola_nome,
            escola_sigla: c.escola_sigla,
            cor_primaria: c.cor_primaria
          }
        }
      });
    }

    // REGRA 2: Se tiver 2 ou mais contas, NÃO CRIA SESSÃO AINDA.
    return res.status(200).json({
      success: true,
      message: 'Selecione qual conta pretende aceder.',
      data: { modo: 'collection', redirect: '/selecionar' }
    });

  } catch (error) {
    console.error('[AUTH] Erro geral no login:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao realizar login.' });
  }
});

// 2) ESCOLHER CONTAS
router.get('/contas', verificarAutenticacao, async (req, res) => {
  try {
    const user = req.user;
    const contextos = await buscarContextos(user.id);
    const contas = contextos.map(c => ({
      associacao_id: c.associacao_id,
      escola_id: c.escola_id,
      escola_nome: c.escola_nome,
      escola_sigla: c.escola_sigla,
      cor_primaria: c.cor_primaria,
      papel: c.papel_nome,
      papel_norm: normalizarPapel(c.papel_nome)
    }));
    return res.status(200).json({ success: true, contas });
  } catch (error) {
    console.error('[AUTH] Erro contas:', error);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});


// 3) SOBRE MIM
router.get('/me', verificarAutenticacao, async (req, res) => {
  try {
    const user = req.user;
    if (user.isOwner) {
      return res.status(200).json({
        success: true, data: { tipo: 'owner', id: user.id, nome: user.nome, login_id: user.login_id, email: user.email, conta_ativa: null }
      });
    }
    if (!req.contaAtiva) {
      return res.status(200).json({
        success: true, data: { tipo: 'normal', necessita_escolha: true, redirect: '/selecionar', id: user.id, nome: user.nome, login_id: user.login_id, email: user.email, conta_ativa: null }
      });
    }
    return res.status(200).json({
      success: true,
      data: {
        tipo: 'normal',
        necessita_escolha: false,
        id: user.id,
        nome: user.nome,
        login_id: user.login_id,
        email: user.email,
        conta_ativa: {
          associacao_id: req.contaAtiva.associacao_id,
          escola_id: req.contaAtiva.escola_id,
          escola_nome: req.contaAtiva.escola_nome,
          escola_sigla: req.contaAtiva.escola_sigla,
          cor_primaria: req.contaAtiva.cor_primaria,
          papel: req.contaAtiva.papel,
          papel_norm: req.contaAtiva.papel_norm
        }
      }
    });
  } catch (error) {
    console.error('[AUTH] Erro me:', error);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

// 4) MUDAR-CONTA
router.post('/mudar-conta', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const user = req.user;
    const { associacao_id } = req.body || {};
    if (user.isOwner) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Owner não usa mudar-conta.' });
    }
    if (!associacao_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'associacao_id é obrigatório.' });
    }
    const ctx = await client.query(
      `SELECT a.id, a.escola_id, p.papel, e.nome AS escola_nome, e.sigla AS escola_sigla, e.cor_primaria
       FROM associacoes_escola a
       JOIN papeis_utilizador p ON p.associacao_id = a.id
       LEFT JOIN escolas e ON e.id = a.escola_id
       WHERE a.id = $1 AND a.utilizador_id = $2 AND (a.status IS NULL OR a.status='ativo')`,
      [associacao_id, user.id]
    );
    if (ctx.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Conta inválida.' });
    }
    if (req.session && req.session.id) {
      await client.query('UPDATE sessoes SET revogado = true WHERE id = $1', [req.session.id]);
      await client.query('DELETE FROM conta_ativa WHERE sessao_id = $1', [req.session.id]);
    }
    const sessionId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expira_em = Date.now() + (7 * 24 * 60 * 60 * 1000);
    const ip_address = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const user_agent = req.headers['user-agent'] || 'Desconhecido';
    await client.query(
      `INSERT INTO sessoes (id, utilizador_id, refresh_token_hash, ip_address, user_agent, expira_em, revogado)
       VALUES ($1,$2,$3,$4,$5,$6,false)`,
      [sessionId, user.id, tokenHash, ip_address, user_agent, expira_em]
    );
    const c = ctx.rows[0];
    const papelNorm = normalizarPapel(c.papel);
    await client.query(
      `INSERT INTO conta_ativa (sessao_id, utilizador_id, associacao_id, escola_id, papel, papel_norm)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sessionId, user.id, c.id, c.escola_id, c.papel, papelNorm]
    );
    await client.query('COMMIT');
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('session_token', rawToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.status(200).json({
      success: true,
      message: 'Conta alterada com sucesso.',
      data: {
        redirect: `/dashboard/${papelNorm || c.papel}`,
        conta_ativa: {
          papel: c.papel,
          papel_norm: papelNorm,
          escola_id: c.escola_id,
          escola_nome: c.escola_nome,
          escola_sigla: c.escola_sigla,
          cor_primaria: c.cor_primaria
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[AUTH] Erro mudar-conta:', error);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  } finally {
    client.release();
  }
});

// 5) LOGOUT
router.post('/logout', verificarAutenticacao, async (req, res) => {
  try {
    const sessaoId = req.session?.id;
    if (sessaoId) {
      try { await db.query('UPDATE sessoes SET revogado = true WHERE id = $1', [sessaoId]); } catch(e) {}
      try { await db.query('DELETE FROM conta_ativa WHERE sessao_id = $1', [sessaoId]); } catch(e) {}
    }
    res.clearCookie('session_token');
    return res.status(200).json({ success: true, message: 'Logout efetuado com sucesso.' });
  } catch (error) {
    console.error('[AUTH] Erro logout:', error);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
});

module.exports = router;
