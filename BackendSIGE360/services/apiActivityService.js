const db = require('../config/db');

const ROLES = ['direcao', 'secretaria', 'tesouraria', 'professor'];
const MAX_AUDIT_BYTES = 16000;
const MAX_STRING_LENGTH = 3000;
const SENSITIVE_KEY = /(password|senha|token|secret|authorization|cookie|refresh|access[_-]?key|private[_-]?key|client[_-]?secret|otp|pin)/i;

function sanitizarValor(valor, profundidade = 0, vistos = new WeakSet()) {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'number') return valor;
  if (typeof valor === 'string') {
    return valor.length > MAX_STRING_LENGTH ? `${valor.slice(0, MAX_STRING_LENGTH)}… [texto truncado]` : valor;
  }
  if (typeof valor !== 'object') return String(valor);
  if (profundidade >= 6) return '[limite de profundidade]';
  if (vistos.has(valor)) return '[referência circular]';
  vistos.add(valor);

  if (Buffer.isBuffer(valor)) return `[binário omitido: ${valor.length} bytes]`;
  if (Array.isArray(valor)) return valor.slice(0, 100).map((item) => sanitizarValor(item, profundidade + 1, vistos));

  return Object.fromEntries(
    Object.entries(valor).slice(0, 100).map(([chave, item]) => [
      chave,
      SENSITIVE_KEY.test(chave) ? '[redigido]' : sanitizarValor(item, profundidade + 1, vistos)
    ])
  );
}

function limitarDetalhes(detalhes) {
  const json = JSON.stringify(detalhes);
  if (Buffer.byteLength(json, 'utf8') <= MAX_AUDIT_BYTES) return detalhes;
  return {
    ...detalhes,
    request_body: detalhes.request_body ? '[conteúdo excedeu o limite de auditoria]' : undefined,
    response_body: detalhes.response_body ? '[conteúdo excedeu o limite de auditoria]' : undefined,
    query: detalhes.query ? '[conteúdo excedeu o limite de auditoria]' : undefined,
    detalhes_truncados: true
  };
}

function classificarAtividade(req, caminho) {
  const rota = String(caminho || `${req.baseUrl || ''}${req.route?.path || req.path || ''}`).toLowerCase();
  const metodo = String(req.method || 'GET').toUpperCase();
  const escrita = !['GET', 'HEAD', 'OPTIONS'].includes(metodo);

  if (/\/(auth\/me|notificacoes|owner\/audit)(?:\/|$)/.test(rota)) return null;

  let categoria = 'configuracao';
  let titulo = 'Configuração da escola';
  let destinatarios = ['direcao', 'secretaria'];

  if (/\/(tesouraria|pagamentos?|propinas|recibos|financeir[oa])(?:\/|$)/.test(rota)) {
    categoria = 'pagamento';
    titulo = 'Atividade financeira';
    destinatarios = ['direcao', 'tesouraria'];
  } else if (/\/(uploads|documentos|ficheiros-partilhados)(?:\/|$)/.test(rota)) {
    categoria = 'documento';
    titulo = 'Documento partilhado';
    destinatarios = ['direcao'];
    const alvos = req.body?.destinatarios;
    let papeis = Array.isArray(alvos) ? alvos : [];
    if (typeof alvos === 'string') {
      try {
        const parsed = JSON.parse(alvos);
        if (Array.isArray(parsed)) papeis = parsed;
      } catch {
        papeis = [];
      }
    }
    destinatarios = [...new Set([...destinatarios, 'secretaria', ...papeis.filter((papel) => ROLES.includes(papel))])];
  } else if (/\/(accounts|utilizadores|usuarios|seguranca|auth)(?:\/|$)/.test(rota)) {
    categoria = 'seguranca';
    titulo = 'Atividade de segurança e acessos';
    destinatarios = ['direcao', 'secretaria'];
  } else if (/\/(anos-letivos|trimestres|polos)(?:\/|$)/.test(rota)) {
    categoria = rota.includes('ano') || rota.includes('trimestre') ? 'ano' : 'configuracao';
    titulo = categoria === 'ano' ? 'Configuração do ano letivo' : 'Configuração de polos';
    destinatarios = ['direcao', 'secretaria'];
  } else if (/\/(disciplinas|materias)(?:\/|$)/.test(rota)) {
    categoria = 'academico';
    titulo = 'Atividade académica';
    destinatarios = ['direcao', 'secretaria', 'professor'];
  } else if (/\/turmas(?:\/|$)/.test(rota)) {
    categoria = 'turma';
    titulo = 'Atividade de turma';
    destinatarios = ['direcao', 'secretaria', 'professor'];
  } else if (/\/(alunos|matriculas?|secretaria)(?:\/|$)/.test(rota)) {
    categoria = 'matricula';
    titulo = 'Atividade de matrícula e secretaria';
    destinatarios = ['direcao', 'secretaria'];
  } else if (/\/(notas|professores)(?:\/|$)/.test(rota)) {
    categoria = 'academico';
    titulo = 'Atividade académica';
    destinatarios = ['direcao', 'secretaria', 'professor'];
  } else if (/\/escolas(?:\/|$)/.test(rota)) {
    categoria = 'configuracao';
    titulo = 'Configuração da escola';
    destinatarios = ['direcao', 'secretaria'];
  } else {
    return {
      rota,
      metodo,
      escrita,
      categoria: 'auditoria',
      titulo: 'Atividade do sistema',
      destinatarios: []
    };
  }

  return { rota, metodo, escrita, categoria, titulo, destinatarios };
}

function obterEnderecoIp(req) {
  const endereco = req.ip || req.socket?.remoteAddress || null;
  return endereco?.startsWith('::ffff:') ? endereco.slice(7) : endereco;
}

function formatarMensagem(atividade, req, status) {
  const resultado = status >= 400 ? 'não concluída' : atividade.escrita ? 'registada' : 'consultada';
  const papel = req.contaAtiva?.papel_norm || req.contaAtiva?.papel || req.user?.tipo_conta || 'utilizador';
  return `${atividade.titulo} ${resultado} por ${req.user?.nome || 'utilizador'} (${papel}).`;
}

async function registarAtividadeApi(req, status, caminho, resposta) {
  const atividade = classificarAtividade(req, caminho);
  if (!atividade || !req.user?.id) return;

  const escolaId = req.contaAtiva?.escola_id || null;
  const ipAddress = obterEnderecoIp(req);
  const detalhes = limitarDetalhes({
    metodo: atividade.metodo,
    rota: atividade.rota,
    status_http: status,
    resultado: status >= 400 ? 'falha' : 'sucesso',
    papel: req.contaAtiva?.papel_norm || req.contaAtiva?.papel || req.user?.tipo_conta || null,
    ip_address: ipAddress,
    route_params: Object.keys(req.params || {}).length ? sanitizarValor(req.params) : undefined,
    query: Object.keys(req.query || {}).length ? sanitizarValor(req.query) : undefined,
    request_body: atividade.escrita ? sanitizarValor(req.body || {}) : undefined,
    response_body: (atividade.escrita || status >= 400) && resposta !== undefined
      ? sanitizarValor(resposta)
      : undefined
  });

  try {
    const auditoria = await db.query(
      `INSERT INTO platform_audit_log (actor_id, escola_id, acao, entidade, detalhes)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [
        req.user.id,
        escolaId,
        `${atividade.metodo} ${atividade.rota}`,
        atividade.rota.split('/').filter(Boolean).find((segmento) => !['api', 'v1'].includes(segmento)) || 'api',
        JSON.stringify(detalhes)
      ]
    );

    const ownerEnrollmentNotificationHandled = req.user?.isOwner === true
      && atividade.metodo === 'POST'
      && /\/alunos\/matricular$/.test(atividade.rota);
    if (ownerEnrollmentNotificationHandled
      || !escolaId
      || !atividade.escrita
      || status >= 400
      || !atividade.destinatarios.length) return;
    await db.query(
      `INSERT INTO platform_notifications
        (audit_log_id, escola_id, categoria, titulo, mensagem, autor_id, destinatarios)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
      [
        auditoria.rows[0]?.id || null,
        escolaId,
        atividade.categoria,
        atividade.titulo,
        formatarMensagem(atividade, req, status),
        req.user.id,
        atividade.destinatarios
      ]
    );
  } catch (error) {
    console.error('[ACTIVITY] Não foi possível registar a atividade da API:', error);
  }
}

module.exports = { registarAtividadeApi };
