const db = require('../config/db');

async function registarAuditoria({ actorId, escolaId = null, acao, entidade, entidadeId = null, detalhes = {}, ipAddress = null }) {
  try {
    const auditDetails = ipAddress ? { ...detalhes, ip_address: ipAddress } : detalhes;
    await db.query(
      `INSERT INTO platform_audit_log
        (actor_id, escola_id, acao, entidade, entidade_id, detalhes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [actorId || null, escolaId, acao, entidade, entidadeId, JSON.stringify(auditDetails)]
    );
  } catch (error) {
    console.error('[AUDIT] Não foi possível persistir o evento de auditoria:', error);
  }
}

module.exports = { registarAuditoria };
