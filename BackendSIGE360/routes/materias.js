const express = require('express');
const router = express.Router();
const db = require('../config/db');
const verificarAutenticacao = require('../middlewares/middleware');

async function obterProfessorAutenticado(req) {
  const escolaId = req.contaAtiva?.escola_id;
  if (!escolaId || !req.user?.id) return null;

  const resultado = await db.query(
    `SELECT f.id AS funcionario_id, f.escola_id, u.nome
     FROM funcionarios f
     JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
     JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
     JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
     WHERE f.utilizador_id = $1 AND f.escola_id = $2
       AND ae.status = 'ativo' AND LOWER(TRIM(pu.papel)) = 'professor'
     LIMIT 1`,
    [req.user.id, escolaId]
  );
  return resultado.rows[0] || null;
}

router.post('/upload', verificarAutenticacao, (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'O envio antigo foi desativado. Utilize a área Partilha de ficheiros para escolher a visibilidade e os destinatários.'
  });
});

router.get('/meus-materiais', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    const professor = await obterProfessorAutenticado(req);
    if (!escolaId || !professor) {
      return res.status(403).json({ success: false, message: 'Acesso negado.' });
    }

    const resultado = await db.query(
      `SELECT id, nome_original, caminho_ficheiro, tipo_documento,
              tamanho_bytes, descricao, estado, criado_em
       FROM documentos_uploads
       WHERE escola_id = $1 AND funcionario_id = $2 AND estado = 'ativo'
       ORDER BY criado_em DESC`,
      [escolaId, professor.funcionario_id]
    );
    return res.json({ success: true, total: resultado.rowCount, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar materiais:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar lista de materiais.' });
  }
});

module.exports = router;
