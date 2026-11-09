const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');
const { hashPassword } = require('../services/authService');
const { registarAuditoria } = require('../services/ownerAuditService');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');

function exigirOwner(req, res, next) {
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: 'Apenas o Owner pode aceder à gestão da plataforma.' });
  }
  return next();
}

const limitesRelatoErro = new Map();
const JANELA_RELATO_ERRO_MS = 15 * 60 * 1000;
const MAX_RELATOS_POR_IP = 30;

function limitarRelatoErro(req, res, next) {
  const agora = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || 'desconhecido';
  let limite = limitesRelatoErro.get(ip);
  if (!limite || agora >= limite.expiraEm) {
    limite = { total: 0, expiraEm: agora + JANELA_RELATO_ERRO_MS };
  }
  limite.total += 1;
  limitesRelatoErro.set(ip, limite);
  if (limitesRelatoErro.size > 10000) {
    for (const [endereco, valor] of limitesRelatoErro) {
      if (agora >= valor.expiraEm) limitesRelatoErro.delete(endereco);
    }
  }
  if (limite.total > MAX_RELATOS_POR_IP) {
    return res.status(429).json({ success: false, message: 'Limite de relatos de erro atingido.' });
  }
  return next();
}

function normalizarCaminhoRelato(valor) {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//')) return null;
  try {
    const url = new URL(valor, 'http://localhost');
    return url.origin === 'http://localhost' ? url.pathname.slice(0, 500) : null;
  } catch {
    return null;
  }
}

// Configuração do Nodemailer (Substitui com as tuas credenciais SMTP ou ambiente)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port: process.env.SMTP_PORT || 2525,
  auth: {
    user: process.env.SMTP_USER || 'seu_usuario',
    pass: process.env.SMTP_PASS || 'sua_senha'
  }
});

// Função para gerar a senha baseada nos últimos 7 dígitos do telefone do diretor
function gerarSenhaPorTelefone(telefone) {
  if (!telefone) return '1234567'; // Fallback de segurança
  const digitos = telefone.replace(/\D/g, ''); // Remove tudo o que não for número
  if (digitos.length >= 7) {
    return digitos.slice(-7); // Retorna os últimos 7 números
  }
  return digitos.length > 0 ? digitos.padEnd(7, '0') : '1234567';
}

// Validação simplificada (sem limite de 30 KB, aceita qualquer tamanho de foto/URL)
function validarLogoUrl(logoUrl) {
  if (logoUrl == null || logoUrl === '') return { valido: true, valor: null };
  if (typeof logoUrl !== 'string') return { valido: false };
  return { valido: true, valor: logoUrl };
}

// ============================================================
// ROTA: CRIAR ESCOLA
// ============================================================
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
      regime_periodo, // Período / datas de início e fim do ano letivo
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

    // A. Validar logótipo (aceita qualquer tamanho agora)
    const logoValidado = validarLogoUrl(logo_url);
    if (!logoValidado.valido) {
      return res.status(400).json({ success: false, message: 'URL ou formato de logótipo inválido.' });
    }

    // B. Validações básicas obrigatórias
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

    // C. Iniciar Transação Atómica
    await client.query("BEGIN");
    await client.query('SELECT pg_advisory_xact_lock($1)', [7462301]);

    // D. Verificar se os níveis de ensino existem
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

    // E. Inserir Escola na Base de Dados
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
        regime_periodo || null, // Período / Datas do ano letivo enviado pelo frontend
        cor_primaria || "#0284c7", 
        motto || null, 
        visao?.trim() || null,
        missao?.trim() || null,
        valor?.trim() || null,
      ]
    );
    const escola = escolaResult.rows[0];

    // F. Associar Níveis de Ensino à Escola
    for (const nivelId of ids) {
      await client.query(
        `INSERT INTO escolas_niveis (escola_id, nivel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [escola.id, nivelId]
      );
    }

    // G. Gerar ID de Acesso (Login ID) da Direção
    const countRes = await client.query(`SELECT COUNT(*) as total FROM escolas`);
    const seqId = String(parseInt(countRes.rows[0].total, 10)).padStart(3, '0');
    const categoriaNumero = Number(categoria);
    const catCode = categoriaNumero === 2 ? '0' : categoriaNumero === 1 ? '1' : '2';
    const loginIdDirecao = `S${siglaLogin}${catCode}${codigoAcademico}${seqId}`;
    
    // H. Gerar senha automática com os últimos 7 dígitos do telefone
    const passwordTemporaria = gerarSenhaPorTelefone(diretor_contacto);
    const hash = await hashPassword(passwordTemporaria);

    const nomeDiretor = diretor_nome?.trim() || `Direção ${nome_escola.trim()}`;
    const emailDiretor = diretor_email?.trim() || `direcao.${sigla.toLowerCase()}@futurese.gw`;

    // I. Criar Utilizador da Direção
    const userRes = await client.query(
      `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta) 
       VALUES ($1, $2, $3, $4, $5, true, 'normal') RETURNING id`,
      [nomeDiretor, emailDiretor, diretor_contacto || null, loginIdDirecao, hash]
    );
    const userId = userRes.rows[0].id;

    // J. Criar Associação Escola-Utilizador
    const assocRes = await client.query(
      `INSERT INTO associacoes_escola (escola_id, utilizador_id, status) VALUES ($1, $2, 'ativo') RETURNING id`,
      [escola.id, userId]
    );
    const associacaoId = assocRes.rows[0].id;

    // K. Atribuir Papel de Direção
    await client.query(
      `INSERT INTO papeis_utilizador (associacao_id, papel) VALUES ($1, 'direcao') ON CONFLICT DO NOTHING`,
      [associacaoId]
    );

    // L. Confirmar transação com sucesso
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

router.get('/operations/overview', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const [escolas, utilizadores, tickets, auditoria, escolasRecentes, alunos, funcionarios, pagamentos, pagamentosRecentes, categorias, escolasComAlunos, agendaTickets, agendaAuditoria] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status_verificacao IN ('ativo', 'verified'))::int AS ativas
         FROM escolas`
      ),
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status_ativo = true)::int AS ativos
         FROM utilizadores WHERE tipo_conta <> 'owner'`
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
         FROM platform_support_tickets`
      ),
      db.query(
        `SELECT a.id, a.acao, a.entidade, a.entidade_id, a.detalhes, a.criado_em,
                COALESCE(to_jsonb(a)->>'ip_address', a.detalhes->>'ip_address') AS ip_address,
                u.nome AS actor_nome, e.nome AS escola_nome
           FROM platform_audit_log a
           LEFT JOIN utilizadores u ON u.id = a.actor_id
           LEFT JOIN escolas e ON e.id = a.escola_id
           ORDER BY a.criado_em DESC LIMIT 8`
      ),
      db.query(
        `SELECT id, nome, sigla, status_verificacao, criado_em
         FROM escolas ORDER BY criado_em DESC LIMIT 5`
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM alunos`),
      db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS total
         FROM utilizadores u
         JOIN associacoes_escola ae
           ON ae.utilizador_id = u.id AND ae.status = 'ativo'
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
         WHERE u.status_ativo = true
           AND LOWER(TRIM(pu.papel)) IN ('direcao', 'professor', 'secretaria', 'tesouraria')`
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE estado = 'aprovado')::int AS aprovados,
                COALESCE(SUM(valor) FILTER (WHERE estado = 'aprovado'), 0)::numeric(14,2) AS valor_aprovado,
                COUNT(*) FILTER (WHERE estado IN ('pendente_aprovacao', 'pendente'))::int AS pendentes
         FROM tesouraria_pagamentos`
      ),
      db.query(
        `SELECT registo.id, registo.valor, registo.data_pagamento, registo.estado,
                registo.tipo_registo, registo.codigo_talao,
                e.nome AS escola_nome, u.nome AS registado_por_nome
         FROM (
           SELECT p.id, p.escola_id, p.registado_por, p.valor, p.data_pagamento,
                  p.estado, p.tipo_registo, p.codigo_talao, p.criado_em
           FROM tesouraria_pagamentos p

           UNION ALL

           SELECT m.id, m.escola_id, m.registado_por, m.valor, m.data_movimento,
                  'registado'::text AS estado, 'movimento_manual'::text AS tipo_registo,
                  m.referencia AS codigo_talao, m.criado_em
           FROM tesouraria_movimentos m
           WHERE m.tipo = 'entrada'
         ) registo
         JOIN escolas e ON e.id = registo.escola_id
         LEFT JOIN utilizadores u ON u.id = registo.registado_por
         ORDER BY registo.criado_em DESC LIMIT 10`
      ),
      db.query(
        `SELECT COALESCE(categoria, 0)::int AS categoria, COUNT(*)::int AS total
         FROM escolas GROUP BY categoria ORDER BY categoria`
      ),
      db.query(
        `SELECT e.id, e.nome, e.local, COUNT(DISTINCT m.aluno_id)::int AS alunos
         FROM escolas e
         LEFT JOIN matriculas m ON m.escola_id = e.id AND m.estado = 'ativa'
         GROUP BY e.id, e.nome, e.local
         ORDER BY alunos DESC, e.nome ASC LIMIT 5`
      ),
      db.query(
        `SELECT t.id, t.titulo AS titulo, t.categoria, t.prioridade, t.estado,
                t.criado_em AS data_evento, e.nome AS escola_nome, 'suporte' AS tipo
         FROM platform_support_tickets t
         LEFT JOIN escolas e ON e.id = t.escola_id
         WHERE t.criado_em >= CURRENT_TIMESTAMP - INTERVAL '90 days'
         ORDER BY t.criado_em DESC LIMIT 100`
      ),
      db.query(
        `SELECT a.id, a.acao AS titulo, a.entidade AS categoria, 'normal' AS prioridade,
                a.criado_em AS data_evento, e.nome AS escola_nome, 'auditoria' AS tipo
         FROM platform_audit_log a
         LEFT JOIN escolas e ON e.id = a.escola_id
         WHERE a.criado_em >= CURRENT_TIMESTAMP - INTERVAL '90 days'
         ORDER BY a.criado_em DESC LIMIT 100`
      )
    ]);

    return res.json({
      success: true,
      data: {
        escolas: escolas.rows[0],
        utilizadores: utilizadores.rows[0],
        alunos: alunos.rows[0],
        funcionarios: funcionarios.rows[0],
        pagamentos: pagamentos.rows[0],
        tickets_total: tickets.rows[0].total,
        atividade_recente: auditoria.rows,
        escolas_recentes: escolasRecentes.rows,
        pagamentos_recentes: pagamentosRecentes.rows,
        escolas_por_categoria: categorias.rows,
        escolas_com_alunos: escolasComAlunos.rows,
        agenda_eventos: [...agendaTickets.rows, ...agendaAuditoria.rows]
          .sort((a, b) => new Date(b.data_evento) - new Date(a.data_evento)),
        data_atual: new Date().toISOString(),
        backend_uptime_segundos: Math.floor(process.uptime())
      }
    });
  } catch (error) {
    console.error('[OWNER] Erro ao carregar visão geral da plataforma:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o painel da plataforma.' });
  }
});

router.get('/operations/health', verificarAutenticacao, exigirOwner, async (req, res) => {
  const inicio = Date.now();
  try {
    const resultado = await db.query('SELECT CURRENT_TIMESTAMP AS verificado_em');
    return res.json({
      success: true,
      data: {
        backend: 'operacional',
        base_dados: 'operacional',
        latencia_base_dados_ms: Date.now() - inicio,
        verificado_em: resultado.rows[0].verificado_em,
        uptime_segundos: Math.floor(process.uptime()),
        versao_node: process.version
      }
    });
  } catch (error) {
    console.error('[OWNER] Verificação de saúde da plataforma falhou:', error);
    return res.status(503).json({
      success: false,
      message: 'A base de dados não respondeu à verificação.',
      data: {
        backend: 'operacional',
        base_dados: 'indisponivel',
        verificado_em: new Date().toISOString()
      }
    });
  }
});

router.post('/support/errors/report', limitarRelatoErro, async (req, res) => {
  const { tipo, status_http: statusHttp, metodo, rota, pagina, mensagem, stack, user_agent: userAgent } = req.body || {};
  const tipos = ['http', 'rede', 'javascript', 'promise'];
  const rotaNormalizada = normalizarCaminhoRelato(rota);
  const paginaNormalizada = normalizarCaminhoRelato(pagina);
  const statusValido = statusHttp === null ||
    (Number.isInteger(statusHttp) && (statusHttp === 0 || (statusHttp >= 400 && statusHttp <= 599)));
  if (!tipos.includes(tipo) || !statusValido || !rotaNormalizada || !paginaNormalizada ||
    typeof mensagem !== 'string' || !mensagem.trim() || mensagem.length > 2000 ||
    (metodo !== null && (typeof metodo !== 'string' || !/^[A-Z]{3,10}$/.test(metodo))) ||
    (stack !== undefined && (typeof stack !== 'string' || stack.length > 6000)) ||
    (userAgent !== undefined && (typeof userAgent !== 'string' || userAgent.length > 500))) {
    return res.status(400).json({ success: false, message: 'Dados da ocorrência automática inválidos.' });
  }

  try {
    await db.query(
      `INSERT INTO platform_error_occurrences
        (tipo, status_http, metodo, rota, pagina, mensagem, stack, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tipo,
        statusHttp,
        metodo || null,
        rotaNormalizada,
        paginaNormalizada,
        mensagem.trim(),
        typeof stack === 'string' ? stack : null,
        typeof userAgent === 'string' ? userAgent : null
      ]
    );
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('[OWNER] Erro ao guardar ocorrência automática:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível guardar a ocorrência automática.' });
  }
});

router.get('/support/errors', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const resultado = await db.query(
      `SELECT id, tipo, status_http, metodo, rota, pagina, mensagem, stack, user_agent, criado_em
       FROM platform_error_occurrences
       ORDER BY criado_em DESC
       LIMIT 200`
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error('[OWNER] Erro ao listar ocorrências automáticas:', error);
    if (error.code === '42P01') {
      return res.status(503).json({
        success: false,
        message: 'A tabela de erros automáticos ainda não existe. Aplique a migração 20261105_platform_error_occurrences.sql.'
      });
    }
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as ocorrências automáticas.' });
  }
});

router.get('/support/tickets', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const estado = typeof req.query.estado === 'string' ? req.query.estado : '';
    const permitido = ['aberto', 'em_andamento', 'aguardando_escola', 'resolvido', 'cancelado'];
    if (estado && !permitido.includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado de ocorrência inválido.' });
    }

    const parametros = [];
    const where = estado ? 'WHERE t.estado = $1' : '';
    if (estado) parametros.push(estado);
    const resultado = await db.query(
      `SELECT t.id, t.titulo, t.descricao, t.categoria, t.prioridade, t.estado,
              t.ultima_nota, t.criado_em, t.atualizado_em,
              t.escola_id, e.nome AS escola_nome, u.nome AS criado_por_nome
       FROM platform_support_tickets t
       LEFT JOIN escolas e ON e.id = t.escola_id
       JOIN utilizadores u ON u.id = t.criado_por
       ${where}
       ORDER BY CASE t.prioridade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,
                t.atualizado_em DESC
       LIMIT 200`,
      parametros
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error('[OWNER] Erro ao listar ocorrências de suporte:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as ocorrências de suporte.' });
  }
});

router.post('/support/tickets', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const { escola_id, titulo, descricao, categoria, prioridade } = req.body || {};
    const categorias = ['acesso', 'matricula', 'pagamentos', 'notas', 'dados', 'erro_tecnico', 'outro'];
    const prioridades = ['baixa', 'normal', 'alta', 'critica'];
    if (escola_id && !UUID_PATTERN.test(escola_id)) {
      return res.status(400).json({ success: false, message: 'Escola selecionada inválida.' });
    }
    if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 200 ||
      typeof descricao !== 'string' || !descricao.trim() || descricao.trim().length > 5000) {
      return res.status(400).json({ success: false, message: 'Informe um título (até 200 caracteres) e uma descrição (até 5000 caracteres).' });
    }
    if (categoria !== undefined && !categorias.includes(categoria) ||
      prioridade !== undefined && !prioridades.includes(prioridade)) {
      return res.status(400).json({ success: false, message: 'Categoria ou prioridade inválida.' });
    }

    const resultado = await db.query(
      `INSERT INTO platform_support_tickets
        (escola_id, titulo, descricao, categoria, prioridade, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, escola_id, titulo, descricao, categoria, prioridade, estado, criado_em`,
      [escola_id || null, titulo.trim(), descricao.trim(), categoria || 'outro', prioridade || 'normal', req.user.id]
    );
    const ticket = resultado.rows[0];
    await registarAuditoria({
      actorId: req.user.id,
      escolaId: ticket.escola_id,
      acao: 'ocorrencia_criada',
      entidade: 'suporte',
      entidadeId: ticket.id,
      detalhes: { titulo: ticket.titulo, categoria: ticket.categoria, prioridade: ticket.prioridade },
      ipAddress: req.ip || req.socket?.remoteAddress || null
    });
    return res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error('[OWNER] Erro ao registar ocorrência de suporte:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível registar a ocorrência.' });
  }
});

router.patch('/support/tickets/:id', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, nota } = req.body || {};
    const estados = ['aberto', 'em_andamento', 'aguardando_escola', 'resolvido', 'cancelado'];
    if (!UUID_PATTERN.test(id) || !estados.includes(estado)) {
      return res.status(400).json({ success: false, message: 'Ocorrência ou estado inválido.' });
    }
    if (nota !== undefined && (typeof nota !== 'string' || nota.length > 2000)) {
      return res.status(400).json({ success: false, message: 'A nota deve ter no máximo 2000 caracteres.' });
    }
    const resultado = await db.query(
      `UPDATE platform_support_tickets
       SET estado = $1, ultima_nota = COALESCE($2, ultima_nota), atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, escola_id, titulo, estado, ultima_nota, atualizado_em`,
      [estado, nota === undefined ? null : nota.trim() || null, id]
    );
    if (!resultado.rowCount) {
      return res.status(404).json({ success: false, message: 'Ocorrência não encontrada.' });
    }
    const ticket = resultado.rows[0];
    await registarAuditoria({
      actorId: req.user.id,
      escolaId: ticket.escola_id,
      acao: 'ocorrencia_atualizada',
      entidade: 'suporte',
      entidadeId: ticket.id,
      detalhes: { estado: ticket.estado },
      ipAddress: req.ip || req.socket?.remoteAddress || null
    });
    return res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[OWNER] Erro ao atualizar ocorrência:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar a ocorrência.' });
  }
});

router.get('/support/recipients', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const termo = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (termo.length < 2 || termo.length > 100) {
      return res.status(400).json({ success: false, message: 'A pesquisa deve conter entre 2 e 100 caracteres.' });
    }

    const resultado = await db.query(
      `SELECT u.id, u.nome, u.email, u.login_id,
              COALESCE(
                NULLIF(STRING_AGG(DISTINCT pu.papel, ', '), ''),
                NULLIF(u.tipo_conta, '')
              ) AS papel,
              STRING_AGG(DISTINCT e.nome, ', ') AS escolas
       FROM utilizadores u
       LEFT JOIN associacoes_escola ae
         ON ae.utilizador_id = u.id AND ae.status = 'ativo'
       LEFT JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       LEFT JOIN escolas e ON e.id = ae.escola_id
       WHERE u.status_ativo = true
         AND (
           u.nome ILIKE $1
           OR COALESCE(u.email, '') ILIKE $1
           OR COALESCE(u.login_id, '') ILIKE $1
         )
       GROUP BY u.id
       ORDER BY u.nome ASC
       LIMIT 50`,
      [`%${termo}%`]
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error('[OWNER] Erro ao pesquisar destinatários:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível pesquisar os utilizadores.' });
  }
});

router.post('/support/notifications', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const titulo = typeof req.body?.titulo === 'string' ? req.body.titulo.trim() : '';
    const mensagem = typeof req.body?.mensagem === 'string' ? req.body.mensagem.trim() : '';
    const ids = req.body?.destinatarios;

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100
      || ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
      return res.status(400).json({ success: false, message: 'Selecione entre 1 e 100 destinatários válidos.' });
    }
    if (!titulo || titulo.length > 180 || !mensagem || mensagem.length > 4000) {
      return res.status(400).json({ success: false, message: 'Informe um título (até 180 caracteres) e uma mensagem (até 4000 caracteres).' });
    }

    const destinatarios = [...new Set(ids)];
    const utilizadoresAtivos = await db.query(
      `SELECT id FROM utilizadores WHERE id = ANY($1::uuid[]) AND status_ativo = true`,
      [destinatarios]
    );
    if (utilizadoresAtivos.rowCount !== destinatarios.length) {
      return res.status(400).json({ success: false, message: 'Um ou mais destinatários não existem ou estão inativos.' });
    }

    const resultado = await db.query(
      `INSERT INTO platform_notifications
        (escola_id, categoria, titulo, mensagem, autor_id, destinatarios, recipient_user_ids)
       VALUES (NULL, 'anuncio', $1, $2, $3, '{}'::text[], $4::uuid[])
       RETURNING id, titulo, mensagem, data_hora`,
      [titulo, mensagem, req.user.id, destinatarios]
    );

    await registarAuditoria({
      actorId: req.user.id,
      acao: 'notificacao_enviada',
      entidade: 'notificacao',
      entidadeId: resultado.rows[0].id,
      detalhes: { titulo, destinatarios_total: destinatarios.length },
      ipAddress: req.ip || req.socket?.remoteAddress || null
    });

    return res.status(201).json({
      success: true,
      message: `Notificação enviada a ${destinatarios.length} utilizador${destinatarios.length === 1 ? '' : 'es'}.`,
      data: resultado.rows[0]
    });
  } catch (error) {
    console.error('[OWNER] Erro ao enviar notificação:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível enviar a notificação.' });
  }
});

router.get('/audit', verificarAutenticacao, exigirOwner, async (req, res) => {
  try {
    const escolaId = typeof req.query.escola_id === 'string' ? req.query.escola_id : '';
    if (escolaId && !UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: 'Escola selecionada inválida.' });
    }
    const parametros = escolaId ? [escolaId] : [];
    const where = escolaId ? 'WHERE a.escola_id = $1' : '';
    const resultado = await db.query(
      `SELECT a.id, a.actor_id, u.nome AS actor_nome, a.escola_id, e.nome AS escola_nome,
              a.acao, a.entidade, a.entidade_id, a.detalhes, a.criado_em,
              COALESCE(to_jsonb(a)->>'ip_address', a.detalhes->>'ip_address') AS ip_address
       FROM platform_audit_log a
       LEFT JOIN utilizadores u ON u.id = a.actor_id
       LEFT JOIN escolas e ON e.id = a.escola_id
       ${where}
       ORDER BY a.criado_em DESC
       LIMIT 300`,
      parametros
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error('[OWNER] Erro ao carregar auditoria:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o histórico de auditoria.' });
  }
});

// ============================================================
// 1. ROTAS GLOBAIS (Geridas pelo Owner)
// ============================================================
router.get('/anos-letivos', verificarAutenticacao, async (req, res) => {
  try {
    const resultado = await db.query(
      `SELECT id, ano_nome, ativo, criado_em FROM anos_letivos ORDER BY ano_nome DESC`
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error("Erro ao listar anos letivos globais:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar anos letivos globais." });
  }
});

// POST: Criar novo ano letivo global (Exclusivo Owner)
router.post('/anos-letivos', verificarAutenticacao, async (req, res) => {
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: "Apenas o Owner pode criar anos letivos globais." });
  }

  const { ano_nome, ativo } = req.body || {};
  if (typeof ano_nome !== 'string' || !ano_nome.trim()) {
    return res.status(400).json({ success: false, message: "O nome do ano letivo (ex: 2026/2027) é obrigatório." });
  }
  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({ success: false, message: "O estado ativo deve ser verdadeiro ou falso." });
  }

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    if (ativo === true) {
      await client.query('LOCK TABLE anos_letivos IN EXCLUSIVE MODE');
      await client.query(`UPDATE anos_letivos SET ativo = false WHERE ativo IS DISTINCT FROM false`);
    }

    const novoAno = await client.query(
      `INSERT INTO anos_letivos (ano_nome, ativo) VALUES ($1, $2)
       RETURNING id, ano_nome, ativo, criado_em`,
      [ano_nome.trim(), ativo ?? false]
    );
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: "Ano letivo global criado com sucesso.",
      data: novoAno.rows[0]
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error("Erro ao criar ano letivo global:", error);
    return res.status(500).json({ success: false, message: "Erro ao criar ano letivo global." });
  } finally {
    client?.release();
  }
});

// PUT: Editar ano letivo global (Exclusivo Owner)
router.put('/anos-letivos/:id', verificarAutenticacao, async (req, res) => {
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: "Apenas o Owner pode editar anos letivos globais." });
  }

  const { id } = req.params;
  const { ano_nome, ativo } = req.body || {};

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ success: false, message: "Identificador do ano letivo inválido." });
  }
  if (ano_nome !== undefined && (typeof ano_nome !== 'string' || !ano_nome.trim())) {
    return res.status(400).json({ success: false, message: "O nome do ano letivo não pode ficar vazio." });
  }
  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({ success: false, message: "O estado ativo deve ser verdadeiro ou falso." });
  }
  if (ano_nome === undefined && ativo === undefined) {
    return res.status(400).json({ success: false, message: "Indique o novo nome ou estado do ano letivo." });
  }

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE anos_letivos IN EXCLUSIVE MODE');

    const existente = await client.query(
      `SELECT id FROM anos_letivos WHERE id = $1`,
      [id]
    );
    if (existente.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Ano letivo global não encontrado." });
    }

    if (ativo === true) {
      await client.query(`UPDATE anos_letivos SET ativo = false WHERE id <> $1`, [id]);
    }

    const atualizado = await client.query(
      `UPDATE anos_letivos SET
         ano_nome = COALESCE($1, ano_nome),
         ativo = COALESCE($2, ativo)
       WHERE id = $3
       RETURNING id, ano_nome, ativo, criado_em`,
      [ano_nome === undefined ? null : ano_nome.trim(), ativo ?? null, id]
    );
    await client.query('COMMIT');

    return res.json({
      success: true,
      message: "Ano letivo global atualizado com sucesso.",
      data: atualizado.rows[0]
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error("Erro ao atualizar ano letivo global:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar ano letivo." });
  } finally {
    client?.release();
  }
});

// ============================================================
// ROTA: LER TODAS AS INFORMAÇÕES DE REGISTO DE UMA ÚNICA ESCOLA
// ============================================================
router.get('/escolas/:id/completa', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!req.user?.isOwner && req.contaAtiva?.escola_id !== id) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }

    const query = `
      SELECT 
        e.id,
        e.nome AS nome_escola,
        e.sigla,
        e.subdominio,
        e.nif,
        e.licenca_men,
        e.logo_url,
        e.categoria,
        e.local,
        e.sector,
        e.endereco,
        e.regime_periodo,
        e.cor_primaria,
        e.motto,
        e.visao,
        e.missao,
        e.valor,
        e.status_verificacao,
        -- Retorna o array com os IDs dos níveis de ensino para preencher os checkboxes no frontend
        ARRAY(SELECT en.nivel_id FROM escolas_niveis en WHERE en.escola_id = e.id) AS niveis_ids,
        ARRAY(
          SELECT jsonb_build_object(
            'id', ne.id,
            'nome', ne.nome,
            'codigo_academico', ne.codigo_academico,
            'politica_gratuidade', ne.politica_gratuidade
          )
          FROM escolas_niveis en
          JOIN niveis_ensino ne ON ne.id = en.nivel_id
          WHERE en.escola_id = e.id
          ORDER BY ne.codigo_academico, ne.nome
        ) AS niveis_ensino_detalhes,
        ARRAY(
          SELECT ne.nome
          FROM escolas_niveis en
          JOIN niveis_ensino ne ON ne.id = en.nivel_id
          WHERE en.escola_id = e.id
          ORDER BY ne.codigo_academico, ne.nome
        ) AS niveis_ensino,
        -- Dados completos da Direção / Responsável associado
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
      WHERE e.id = $1;
    `;

    const resultado = await db.query(query, [id]);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Escola não encontrada." 
      });
    }

    return res.json({
      success: true,
      data: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao buscar dados completos da escola:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Erro interno ao carregar as informações da escola." 
    });
  }
});


// ============================================================
// ROTA: LISTAR ESCOLAS PAGINADAS (10 por página, dados essenciais)
// ============================================================
router.get('/escolas/paginadas', verificarAutenticacao, async (req, res) => {
  try {
    // Parâmetros de paginação enviados pelo frontend (ex: /api/v1/escolas/paginadas?page=1&limit=10)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // 1. Query para buscar apenas as 10 escolas da página atual com campos leves
    const query = `
      SELECT 
        e.id,
        e.nome,
        e.sigla,
        e.local,
        e.sector,
        e.status_verificacao,
        e.criado_em,
        direcao.nome AS diretor_nome,
        direcao.telefone AS diretor_contacto
      FROM escolas e
      LEFT JOIN LATERAL (
        SELECT u.nome, u.telefone
        FROM associacoes_escola ae
        JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = 'direcao'
        JOIN utilizadores u ON u.id = ae.utilizador_id
        WHERE ae.escola_id = e.id AND ae.status = 'ativo'
        ORDER BY ae.id DESC LIMIT 1
      ) direcao ON true
      ORDER BY e.criado_em DESC
      LIMIT $1 OFFSET $2;
    `;

    // 2. Query para contar o total de escolas (necessário para calcular o número de páginas no frontend)
    const countQuery = `SELECT COUNT(*) AS total FROM escolas;`;

    // Executar ambas as queries em paralelo para máxima performance
    const [resultadoEscolas, resultadoCount] = await Promise.all([
      db.query(query, [limit, offset]),
      db.query(countQuery)
    ]);

    const totalEscolas = parseInt(resultadoCount.rows[0].total, 10);

    return res.json({
      success: true,
      pagination: {
        total: totalEscolas,
        page,
        limit,
        totalPages: Math.ceil(totalEscolas / limit)
      },
      data: resultadoEscolas.rows
    });

  } catch (error) {
    console.error("Erro ao listar escolas paginadas:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Erro ao carregar a listagem de escolas." 
    });
  }
});


// ============================================================
// API 1: SOLICITAR REDEFINIÇÃO DE SENHA (Envia Email para a Direção)
// ============================================================
router.post('/esqueci-senha', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email?.trim()) {
      return res.status(400).json({ success: false, message: "O email da direção é obrigatório." });
    }

    // Verificar se o utilizador existe e tem papel de 'direcao' associado a uma escola ativa
    const userQuery = `
      SELECT u.id, u.nome, u.email 
      FROM utilizadores u
      JOIN associacoes_escola ae ON ae.utilizador_id = u.id
      JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = 'direcao'
      WHERE u.email = $1 AND ae.status = 'ativo'
      LIMIT 1;
    `;
    const userRes = await db.query(userQuery, [email.trim()]);

    if (userRes.rowCount === 0) {
      return res.json({ success: true, message: "Se o email estiver registado, as instruções foram enviadas." });
    }

    const user = userRes.rows[0];

    // Gerar token seguro e tempo de expiração (ex: 15 minutos)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Guardar token na base de dados
    await db.query(
      `UPDATE utilizadores SET otp = $1, otp_expiry = $2 WHERE id = $3`,
      [resetToken, tokenExpires, user.id]
    );

    // Link de redefinição para o frontend
    const frontendUrl = 'http://localhost:3000';
    const linkRedefinicao = `${frontendUrl}/redefinir-senha?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    // Enviar Email via Nodemailer
    await transporter.sendMail({
      from: '"Future-se - Gestão Escolar" <suporte@futurese.gw>',
      to: user.email,
      subject: 'Redefinição de Palavra-Passe — Direção',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #0284c7;">Future-se | Recuperação de Acesso</h2>
          <p>Olá, <strong>${user.nome}</strong>,</p>
          <p>Recebemos um pedido para redefinir a palavra-passe da conta de Direção.</p>
          <p>Clique no botão abaixo para definir uma nova palavra-passe (válido por 15 minutos):</p>
          <a href="${linkRedefinicao}" style="display: inline-block; padding: 10px 20px; background-color: #0284c7; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Redefinir Palavra-Passe</a>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">Se não solicitou esta alteração, ignore este email.</p>
        </div>
      `
    });

    return res.json({ 
      success: true, 
      message: "Email de recuperação enviado com sucesso para a direção." 
    });

  } catch (error) {
    console.error("Erro ao enviar email de redefinição:", error);
    return res.status(500).json({ success: false, message: "Erro ao processar o pedido de recuperação." });
  }
});


// ============================================================
// API 2: CONFIRMAR E REDEFINIR SENHA + TERMINAR SESSÃO IMEDIATAMENTE
// ============================================================
router.post('/redefinir-senha', async (req, res) => {
  try {
    const { token, nova_password } = req.body || {};

    if (!token || !nova_password) {
      return res.status(400).json({ success: false, message: "Token e nova palavra-passe são obrigatórios." });
    }

    if (nova_password.length < 6) {
      return res.status(400).json({ success: false, message: "A palavra-passe deve ter pelo menos 6 caracteres." });
    }

    // Verificar se o token é válido e ainda não expirou
    const userQuery = `
      SELECT id FROM utilizadores 
      WHERE otp = $1 AND otp_expiry > NOW()
      LIMIT 1;
    `;
    const userRes = await db.query(userQuery, [token]);

    if (userRes.rowCount === 0) {
      return res.status(400).json({ success: false, message: "Token inválido ou expirado." });
    }

    const userId = userRes.rows[0].id;

    // Encriptar a nova senha
    const novoHash = await hashPassword(nova_password);

    // Atualizar password e limpar o token de uso único na base de dados
    await db.query(
      `UPDATE utilizadores 
       SET password_hash = $1, otp = NULL, otp_expiry = NULL, atualizado_em = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [novoHash, userId]
    );

    // TERMINAR SESSÃO IMEDIATAMENTE (Limpar cookie HTTP-only de autenticação)
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    return res.json({ 
      success: true, 
      message: "Palavra-passe alterada com sucesso. A sua sessão foi terminada por segurança. Faça login novamente." 
    });

  } catch (error) {
    console.error("Erro ao redefinir palavra-passe:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar a palavra-passe." });
  }
});



// Outras rotas (listar, editar, status) continuam operacionais...

module.exports = router;