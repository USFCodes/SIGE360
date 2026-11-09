const express = require('express');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');

const router = express.Router();
const ROLES_PERMITIDOS = new Set(['direcao', 'secretaria', 'tesouraria', 'professor']);

function limiteSeguro(valor) {
  const parsed = Number.parseInt(valor, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
}

function offsetSeguro(valor) {
  const parsed = Number.parseInt(valor, 10);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 0), 1000000) : 0;
}

router.get('/', verificarAutenticacao, async (req, res) => {
  try {
    const limit = limiteSeguro(req.query.limit);
    const offset = offsetSeguro(req.query.offset);

    if (req.user?.isOwner === true) {
      const resultado = await db.query(
        `SELECT a.id::text, 'auditoria'::text AS categoria,
                COALESCE(a.detalhes->>'titulo', a.acao) AS titulo,
                COALESCE(a.detalhes->>'mensagem',
                  CONCAT(a.acao, ' · HTTP ', COALESCE(a.detalhes->>'status_http', '—'))) AS mensagem,
                a.criado_em AS data_hora,
                u.nome AS autor,
                e.nome AS escola_nome,
                COALESCE(to_jsonb(a)->>'ip_address', a.detalhes->>'ip_address') AS ip_address,
                a.detalhes->>'papel' AS papel,
                a.detalhes->>'resultado' AS resultado,
                a.detalhes AS detalhes,
                COUNT(*) OVER()::int AS total_count
         FROM platform_audit_log a
         LEFT JOIN utilizadores u ON u.id = a.actor_id
         LEFT JOIN escolas e ON e.id = a.escola_id
         ORDER BY a.criado_em DESC, a.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const total = Number(resultado.rows[0]?.total_count || 0);
      return res.json({
        success: true,
        total,
        dados: resultado.rows.map(({ total_count, ...item }) => item)
      });
    }

    const escolaId = req.contaAtiva?.escola_id;
    const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '').toLowerCase();
    if (!escolaId || !ROLES_PERMITIDOS.has(papel)) {
      return res.status(403).json({ success: false, message: 'O perfil atual não pode consultar estas notificações.' });
    }

    const resultado = await db.query(
      `SELECT n.id::text, n.categoria, n.titulo, n.mensagem,
              n.data_hora, u.nome AS autor, COALESCE(e.nome, 'Plataforma') AS escola_nome,
              NULL::text AS ip_address,
              COUNT(*) OVER()::int AS total_count
       FROM platform_notifications n
       LEFT JOIN escolas e ON e.id = n.escola_id
       LEFT JOIN utilizadores u ON u.id = n.autor_id
       WHERE n.recipient_user_ids @> ARRAY[$5::uuid]
          OR (n.escola_id = $1 AND $2 = ANY(n.destinatarios))
       ORDER BY n.data_hora DESC, n.id DESC
       LIMIT $3 OFFSET $4`,
      [escolaId, papel, limit, offset, req.user.id]
    );
    const total = Number(resultado.rows[0]?.total_count || 0);
    return res.json({
      success: true,
      total,
      dados: resultado.rows.map(({ total_count, ...item }) => item)
    });
  } catch (error) {
    console.error('Erro ao carregar notificações:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as notificações.' });
  }
});

module.exports = router;
