const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');
const { hashPassword } = require('../services/authService');

const router = express.Router();
const documentosDir = path.resolve(__dirname, '../private_uploads/direcao_documentos');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIPOS_DOCUMENTO = new Set(['circular', 'relatorio_financeiro', 'despacho', 'regulamento', 'outro']);
const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;
const MIME_POR_EXTENSAO = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

function verificarPermissaoDirecao(req, res, next) {
  const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
    .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (req.user?.isOwner === true || papel === 'direcao') return next();
  return res.status(403).json({ success: false, message: 'Apenas a Direção pode gerir documentos institucionais.' });
}

function verificarDirecaoDaEscola(req, res, next) {
  const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
    .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (req.user?.isOwner !== true && papel === 'direcao' && req.contaAtiva?.escola_id) return next();
  return res.status(403).json({ success: false, message: 'Apenas a Direção pode gerir os funcionários da sua escola.' });
}

router.get('/funcionarios-senhas', verificarAutenticacao, verificarDirecaoDaEscola, async (req, res) => {
  try {
    const resultado = await db.query(
      `SELECT f.id AS funcionario_id, u.nome, u.email, u.login_id,
              u.status_ativo,
              ARRAY_AGG(DISTINCT LOWER(TRIM(pu.papel)) ORDER BY LOWER(TRIM(pu.papel))) AS papeis
       FROM funcionarios f
       JOIN utilizadores u ON u.id = f.utilizador_id
       JOIN associacoes_escola ae
         ON ae.utilizador_id = f.utilizador_id
        AND ae.escola_id = f.escola_id
        AND (ae.status IS NULL OR ae.status = 'ativo')
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       WHERE f.escola_id = $1
         AND f.utilizador_id <> $2
         AND u.tipo_conta <> 'owner'
         AND LOWER(TRIM(pu.papel)) IN ('direcao', 'professor', 'secretaria', 'tesouraria')
       GROUP BY f.id, u.id
       ORDER BY u.nome ASC`,
      [req.contaAtiva.escola_id, req.user.id]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar funcionários para redefinição de senha:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os funcionários da escola.' });
  }
});

router.post('/funcionarios/:funcionarioId/senha', verificarAutenticacao, verificarDirecaoDaEscola, async (req, res) => {
  const { funcionarioId } = req.params;
  const novaSenha = req.body?.nova_senha;
  if (!UUID_PATTERN.test(funcionarioId || '')) {
    return res.status(400).json({ success: false, message: 'Identificador de funcionário inválido.' });
  }
  if (typeof novaSenha !== 'string' || novaSenha.length < 6 || novaSenha.length > 128) {
    return res.status(400).json({ success: false, message: 'A nova senha deve ter entre 6 e 128 caracteres.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const funcionario = await client.query(
      `SELECT f.utilizador_id
       FROM funcionarios f
       JOIN utilizadores u ON u.id = f.utilizador_id
       JOIN associacoes_escola ae
         ON ae.utilizador_id = f.utilizador_id
        AND ae.escola_id = f.escola_id
        AND (ae.status IS NULL OR ae.status = 'ativo')
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       WHERE f.id = $1
         AND f.escola_id = $2
         AND f.utilizador_id <> $3
         AND u.tipo_conta <> 'owner'
         AND LOWER(TRIM(pu.papel)) IN ('direcao', 'professor', 'secretaria', 'tesouraria')
       LIMIT 1
       FOR UPDATE OF u`,
      [funcionarioId, req.contaAtiva.escola_id, req.user.id]
    );
    if (!funcionario.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Funcionário não encontrado nesta escola.' });
    }

    const utilizadorId = funcionario.rows[0].utilizador_id;
    const passwordHash = await hashPassword(novaSenha);
    await client.query(
      `UPDATE utilizadores
       SET password_hash = $1, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, utilizadorId]
    );
    await client.query(
      `UPDATE sessoes
       SET revogado = true
       WHERE utilizador_id = $1 AND revogado IS NOT TRUE`,
      [utilizadorId]
    );
    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Senha do funcionário alterada. Todas as sessões abertas foram terminadas.'
    });
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      console.error('Erro ao reverter redefinição de senha:', rollbackError);
    });
    console.error('Erro ao redefinir senha de funcionário:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível alterar a senha do funcionário.' });
  } finally {
    client.release();
  }
});

function receberFicheiro(req, res, next) {
  upload.single('ficheiro')(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({
      success: false,
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'O ficheiro excede o limite de 15 MB.'
        : 'Não foi possível receber o ficheiro enviado.'
    });
  });
}

function ficheiroValido(file) {
  if (!file) return false;
  const extensao = path.extname(file.originalname).toLowerCase();
  const buffer = file.buffer;
  if (!Object.hasOwn(MIME_POR_EXTENSAO, extensao)) return false;
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

function escolaAtiva(req, res) {
  const escolaId = req.contaAtiva?.escola_id;
  if (!UUID_PATTERN.test(escolaId || '')) {
    res.status(403).json({ success: false, message: 'É necessária uma escola ativa.' });
    return null;
  }
  return escolaId;
}

async function pautaPertenceEscola(escolaId, turmaId, turmaDisciplinaId, trimestreId, anoLetivoId) {
  const resultado = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM turmas t
       JOIN turma_disciplinas td
         ON td.id = $2 AND td.turma_id = t.id AND td.escola_id = t.escola_id
       JOIN trimestres tr ON tr.id = $3 AND tr.ano_letivo_id = $5
       JOIN escola_anos_letivos eal
         ON eal.ano_letivo_id = tr.ano_letivo_id AND eal.escola_id = t.escola_id
       WHERE t.id = $1 AND t.escola_id = $4 AND t.ano_letivo_id = $5
     ) AS permitido`,
    [turmaId, turmaDisciplinaId, trimestreId, escolaId, anoLetivoId]
  );
  return resultado.rows[0]?.permitido === true;
}

async function validarParametrosPauta(req, res, escolaId) {
  const parametrosOrigem = req.method === 'POST' ? req.body || {} : req.query;
  const {
    turma_id: turmaId,
    turma_disciplina_id: turmaDisciplinaId,
    trimestre_id: trimestreId,
    ano_letivo_id: anoLetivoId
  } = parametrosOrigem;
  if (![turmaId, turmaDisciplinaId, trimestreId, anoLetivoId].every((id) => UUID_PATTERN.test(id || ''))) {
    res.status(400).json({ success: false, message: 'Ano letivo, turma, disciplina ou trimestre inválido.' });
    return null;
  }
  const permitido = await pautaPertenceEscola(escolaId, turmaId, turmaDisciplinaId, trimestreId, anoLetivoId);
  if (!permitido) {
    res.status(404).json({ success: false, message: 'A turma, disciplina ou período não pertence a este ano letivo e escola.' });
    return null;
  }
  return { turmaId, turmaDisciplinaId, trimestreId, anoLetivoId };
}

router.get('/notas/anos-letivos', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  try {
    const resultado = await db.query(
      `SELECT eal.ano_letivo_id AS id, al.ano_nome, eal.ativo,
              eal.data_inicio::text AS data_inicio, eal.data_fim::text AS data_fim
       FROM escola_anos_letivos eal
       JOIN anos_letivos al ON al.id = eal.ano_letivo_id
       WHERE eal.escola_id = $1
       ORDER BY eal.ativo DESC, eal.data_inicio DESC NULLS LAST, al.ano_nome DESC`,
      [escolaId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar anos letivos para a pauta:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os anos letivos.' });
  }
});

router.get('/notas/turmas', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  const anoLetivoId = req.query.ano_letivo_id || null;
  if (anoLetivoId && !UUID_PATTERN.test(anoLetivoId)) {
    return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
  }

  try {
    const resultado = await db.query(
      `SELECT t.id, t.nome, t.classe, t.ano_letivo_id, al.ano_nome
       FROM turmas t
       JOIN escola_anos_letivos eal
         ON eal.escola_id = t.escola_id AND eal.ano_letivo_id = t.ano_letivo_id
       JOIN anos_letivos al ON al.id = t.ano_letivo_id
       WHERE t.escola_id = $1 AND ($2::uuid IS NULL OR t.ano_letivo_id = $2)
       ORDER BY al.ano_nome DESC, t.classe ASC, t.nome ASC`,
      [escolaId, anoLetivoId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar turmas por ano letivo para a pauta:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as turmas.' });
  }
});

router.get('/notas/turmas/:turmaId/disciplinas', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  const { turmaId } = req.params;
  const anoLetivoId = req.query.ano_letivo_id;
  if (!UUID_PATTERN.test(turmaId || '') || !UUID_PATTERN.test(anoLetivoId || '')) {
    return res.status(400).json({ success: false, message: 'Turma ou ano letivo inválido.' });
  }

  try {
    const resultado = await db.query(
      `SELECT td.id, d.nome AS disciplina_nome
       FROM turmas t
       JOIN escola_anos_letivos eal
         ON eal.escola_id = t.escola_id AND eal.ano_letivo_id = t.ano_letivo_id
       JOIN turma_disciplinas td ON td.turma_id = t.id AND td.escola_id = t.escola_id
       JOIN disciplinas d ON d.id = td.disciplina_id
       WHERE t.id = $1 AND t.escola_id = $2 AND t.ano_letivo_id = $3
       ORDER BY d.nome ASC`,
      [turmaId, escolaId, anoLetivoId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar disciplinas da pauta:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as disciplinas da turma.' });
  }
});

router.get('/notas/trimestres', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  const anoLetivoId = req.query.ano_letivo_id;
  if (!UUID_PATTERN.test(anoLetivoId || '')) {
    return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
  }

  try {
    const resultado = await db.query(
      `SELECT tr.id, tr.nome, tr.numero, tr.ano_letivo_id,
              tr.data_inicio::text AS data_inicio, tr.data_fim::text AS data_fim,
              al.ano_nome
       FROM trimestres tr
       JOIN anos_letivos al ON al.id = tr.ano_letivo_id
       JOIN escola_anos_letivos eal ON eal.ano_letivo_id = tr.ano_letivo_id
       LEFT JOIN parametros_avaliacao pa ON pa.escola_id = eal.escola_id
       WHERE eal.escola_id = $1 AND tr.ano_letivo_id = $2
         AND tr.numero <= CASE WHEN pa.sistema_periodo = 'semestres' THEN 2 ELSE 3 END
       ORDER BY tr.numero ASC`,
      [escolaId, anoLetivoId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar períodos letivos para a pauta:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os trimestres.' });
  }
});

router.get('/notas/pauta-geral', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  try {
    const parametros = await validarParametrosPauta(req, res, escolaId);
    if (!parametros) return;

    const resultado = await db.query(
      `SELECT m.id AS matricula_id, a.id AS aluno_id, m.numero_matricula,
              u.nome, a.apelido, t.nome AS turma_nome, t.classe,
              d.nome AS disciplina_nome,
              CASE WHEN nt.id IS NOT NULL AND (
                nt.n1 IS NOT NULL OR nt.n2 IS NOT NULL OR nt.n3 IS NOT NULL
                OR nt.n4 IS NOT NULL OR nt.prova_final IS NOT NULL
              ) THEN nt.id END AS nota_id,
              nt.n1, nt.n2, nt.n3, nt.n4, nt.mac, nt.prova_final, nt.mf
       FROM matriculas m
       JOIN alunos a ON a.id = m.aluno_id
       JOIN utilizadores u ON u.id = a.utilizador_id
       JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
       JOIN turma_disciplinas td
         ON td.id = $2 AND td.turma_id = t.id AND td.escola_id = t.escola_id
       JOIN disciplinas d ON d.id = td.disciplina_id
       LEFT JOIN notas_trimestrais nt
         ON nt.matricula_id = m.id AND nt.turma_disciplina_id = td.id
        AND nt.trimestre_id = $3 AND nt.turma_id = t.id AND nt.escola_id = t.escola_id
       WHERE t.id = $1 AND t.escola_id = $4
         AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $5
         AND (
           m.estado IN ('ativa', 'concluida')
           OR EXISTS (
             SELECT 1 FROM notas_trimestrais historico
             JOIN trimestres periodo ON periodo.id = historico.trimestre_id
             WHERE historico.matricula_id = m.id
               AND historico.turma_id = t.id
               AND historico.escola_id = t.escola_id
               AND periodo.ano_letivo_id = $5
           )
         )
       ORDER BY u.nome ASC, a.apelido ASC`,
      [parametros.turmaId, parametros.turmaDisciplinaId, parametros.trimestreId, escolaId, parametros.anoLetivoId]
    );

    const alunos = resultado.rows;
    alunos.sort((a, b) => {
      const notaA = a.mf === null ? Number.NEGATIVE_INFINITY : Number(a.mf);
      const notaB = b.mf === null ? Number.NEGATIVE_INFINITY : Number(b.mf);
      return notaB - notaA || a.nome.localeCompare(b.nome);
    });
    return res.json({
      success: true,
      dados: alunos.map((aluno, index) => ({ ...aluno, posicao_turma: aluno.mf === null ? null : index + 1 }))
    });
  } catch (error) {
    console.error('Erro ao carregar pauta geral da direção:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a pauta geral.' });
  }
});

router.get('/notas/pauta-turma', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  const { turma_id: turmaId, trimestre_id: trimestreId, ano_letivo_id: anoLetivoId } = req.query;
  if (![turmaId, trimestreId, anoLetivoId].every((id) => UUID_PATTERN.test(id || ''))) {
    return res.status(400).json({ success: false, message: 'Ano letivo, turma ou trimestre inválido.' });
  }

  try {
    const contexto = await db.query(
      `SELECT 1
       FROM turmas t
       JOIN trimestres tr ON tr.id = $2 AND tr.ano_letivo_id = t.ano_letivo_id
       JOIN escola_anos_letivos eal
         ON eal.escola_id = t.escola_id AND eal.ano_letivo_id = t.ano_letivo_id
       WHERE t.id = $1 AND t.escola_id = $3 AND t.ano_letivo_id = $4
       LIMIT 1`,
      [turmaId, trimestreId, escolaId, anoLetivoId]
    );
    if (!contexto.rowCount) {
      return res.status(404).json({ success: false, message: 'A turma ou o período não pertence a este ano letivo e escola.' });
    }

    const resultado = await db.query(
      `SELECT m.id AS matricula_id, a.id AS aluno_id, m.numero_matricula,
              u.nome, a.apelido, t.nome AS turma_nome, t.classe,
              td.id AS turma_disciplina_id, d.nome AS disciplina_nome,
              CASE WHEN nt.id IS NOT NULL AND (
                nt.n1 IS NOT NULL OR nt.n2 IS NOT NULL OR nt.n3 IS NOT NULL
                OR nt.n4 IS NOT NULL OR nt.prova_final IS NOT NULL
              ) THEN nt.id END AS nota_id,
              nt.n1, nt.n2, nt.n3, nt.n4, nt.mac, nt.prova_final, nt.mf,
              CASE WHEN nt.mf IS NOT NULL THEN
                ROW_NUMBER() OVER (
                  PARTITION BY td.id
                  ORDER BY nt.mf DESC NULLS LAST, u.nome ASC, a.apelido ASC
                )
              END AS posicao_turma,
              COALESCE(ap.estado, 'pendente') AS estado_aprovacao,
              ap.comentario AS comentario_aprovacao
       FROM matriculas m
       JOIN alunos a ON a.id = m.aluno_id
       JOIN utilizadores u ON u.id = a.utilizador_id
       JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
       JOIN turma_disciplinas td ON td.turma_id = t.id AND td.escola_id = t.escola_id
       JOIN disciplinas d ON d.id = td.disciplina_id
       LEFT JOIN notas_trimestrais nt
         ON nt.matricula_id = m.id AND nt.turma_disciplina_id = td.id
        AND nt.trimestre_id = $2 AND nt.turma_id = t.id AND nt.escola_id = t.escola_id
       LEFT JOIN direcao_aprovacoes_notas ap
         ON ap.escola_id = t.escola_id AND ap.matricula_id = m.id
        AND ap.turma_disciplina_id = td.id AND ap.trimestre_id = $2
       WHERE t.id = $1 AND t.escola_id = $3
         AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $4
         AND (
           m.estado IN ('ativa', 'concluida')
           OR EXISTS (
             SELECT 1 FROM notas_trimestrais historico
             JOIN trimestres periodo ON periodo.id = historico.trimestre_id
             WHERE historico.matricula_id = m.id
               AND historico.turma_id = t.id
               AND historico.escola_id = t.escola_id
               AND periodo.ano_letivo_id = $4
           )
         )
       ORDER BY u.nome ASC, a.apelido ASC, d.nome ASC`,
      [turmaId, trimestreId, escolaId, anoLetivoId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar pauta por turma da direção:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a pauta da turma.' });
  }
});

router.get('/notas/aprovacoes', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  try {
    const parametros = await validarParametrosPauta(req, res, escolaId);
    if (!parametros) return;

    const resultado = await db.query(
      `SELECT matricula_id, estado, comentario, atualizado_em
       FROM direcao_aprovacoes_notas
       WHERE escola_id = $1 AND turma_disciplina_id = $2 AND trimestre_id = $3
         AND matricula_id IN (
           SELECT id FROM matriculas
           WHERE turma_id = $4 AND escola_id = $1
             AND COALESCE(ano_letivo_id, $5::uuid) = $5
         )`,
      [escolaId, parametros.turmaDisciplinaId, parametros.trimestreId, parametros.turmaId, parametros.anoLetivoId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar estados de aprovação das notas:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os estados de aprovação.' });
  }
});

router.post('/notas/aprovacoes', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  try {
    const parametros = await validarParametrosPauta(req, res, escolaId);
    if (!parametros) return;

    const { matricula_ids: matriculaIds, estado, comentario = '' } = req.body || {};
    if (!['aprovado', 'pendente', 'rejeitado'].includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado de aprovação inválido.' });
    }
    if (typeof comentario !== 'string' || comentario.trim().length > 2000) {
      return res.status(400).json({ success: false, message: 'O comentário deve ter no máximo 2000 caracteres.' });
    }
    if (estado !== 'aprovado' && !comentario.trim()) {
      return res.status(400).json({ success: false, message: 'Escreva um comentário para devolver as notas ao professor.' });
    }
    if (!Array.isArray(matriculaIds) || matriculaIds.length === 0 || matriculaIds.length > 5000
      || !matriculaIds.every((id) => UUID_PATTERN.test(id || ''))) {
      return res.status(400).json({ success: false, message: 'Selecione pelo menos um aluno válido.' });
    }
    const idsUnicos = [...new Set(matriculaIds)];
    if (idsUnicos.length !== matriculaIds.length) {
      return res.status(400).json({ success: false, message: 'A lista de alunos contém identificadores repetidos.' });
    }

    const matriculas = await db.query(
      `SELECT id FROM matriculas
       WHERE id = ANY($1::uuid[]) AND turma_id = $2 AND escola_id = $3
         AND COALESCE(ano_letivo_id, $4::uuid) = $4`,
      [idsUnicos, parametros.turmaId, escolaId, parametros.anoLetivoId]
    );
    if (matriculas.rowCount !== idsUnicos.length) {
      return res.status(400).json({ success: false, message: 'Uma ou mais matrículas não pertencem a esta pauta.' });
    }

    const notasSubmetidas = await db.query(
      `SELECT COUNT(DISTINCT nt.matricula_id)::int AS total
       FROM notas_trimestrais nt
       WHERE nt.escola_id = $1 AND nt.turma_id = $2
         AND nt.turma_disciplina_id = $3 AND nt.trimestre_id = $4
         AND nt.matricula_id = ANY($5::uuid[])
         AND (nt.n1 IS NOT NULL OR nt.n2 IS NOT NULL OR nt.n3 IS NOT NULL
              OR nt.n4 IS NOT NULL OR nt.prova_final IS NOT NULL)`,
      [escolaId, parametros.turmaId, parametros.turmaDisciplinaId, parametros.trimestreId, idsUnicos]
    );
    if (notasSubmetidas.rows[0]?.total !== idsUnicos.length) {
      return res.status(400).json({ success: false, message: 'Só é possível rever ou aprovar alunos com notas submetidas pelo professor.' });
    }

    await db.query(
      `INSERT INTO direcao_aprovacoes_notas
         (escola_id, matricula_id, turma_disciplina_id, trimestre_id, estado, comentario, atualizado_por)
       SELECT $1, alvo.matricula_id, $3, $4, $5, $6, $7
       FROM unnest($2::uuid[]) AS alvo(matricula_id)
       ON CONFLICT (escola_id, matricula_id, turma_disciplina_id, trimestre_id)
       DO UPDATE SET estado = EXCLUDED.estado,
                     comentario = EXCLUDED.comentario,
                     atualizado_por = EXCLUDED.atualizado_por,
                     atualizado_em = CURRENT_TIMESTAMP`,
      [escolaId, idsUnicos, parametros.turmaDisciplinaId, parametros.trimestreId, estado, comentario.trim(), req.user.id]
    );

    return res.json({ success: true, message: 'Estado de aprovação atualizado.', dados: { estado, matricula_ids: idsUnicos } });
  } catch (error) {
    console.error('Erro ao atualizar aprovação das notas:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar a aprovação das notas.' });
  }
});

router.get('/notas/aluno/:alunoId/historico', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  const { alunoId } = req.params;
  if (!UUID_PATTERN.test(alunoId || '')) {
    return res.status(400).json({ success: false, message: 'Identificador do aluno inválido.' });
  }
  const anoLetivoId = req.query.ano_letivo_id || null;
  const trimestreId = req.query.trimestre_id || null;
  if ((anoLetivoId && !UUID_PATTERN.test(anoLetivoId)) || (trimestreId && !UUID_PATTERN.test(trimestreId))) {
    return res.status(400).json({ success: false, message: 'Ano letivo ou trimestre inválido.' });
  }

  try {
    if (anoLetivoId) {
      const ano = await db.query(
        `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
        [escolaId, anoLetivoId]
      );
      if (ano.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'O ano letivo não pertence a esta escola.' });
      }
    }
    if (trimestreId) {
      const trimestre = await db.query(
        `SELECT 1 FROM trimestres tr
         JOIN escola_anos_letivos eal ON eal.ano_letivo_id = tr.ano_letivo_id
         WHERE tr.id = $1 AND eal.escola_id = $2
           AND ($3::uuid IS NULL OR tr.ano_letivo_id = $3)`,
        [trimestreId, escolaId, anoLetivoId]
      );
      if (trimestre.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'O trimestre não pertence ao ano letivo selecionado.' });
      }
    }
    const resultado = await db.query(
      `SELECT td.id AS turma_disciplina_id, tr.id AS trimestre_id, tr.numero AS trimestre_numero,
              d.nome AS disciplina_nome, tr.nome AS trimestre_nome, al.ano_nome,
              td.ativo AS disciplina_ativa,
              nt.n1, nt.n2, nt.n3, nt.n4, nt.mac, nt.prova_final, nt.mf
       FROM matriculas m
       JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
       JOIN alunos a ON a.id = m.aluno_id
       JOIN turma_disciplinas td
         ON td.turma_id = t.id AND td.escola_id = t.escola_id
       JOIN disciplinas d ON d.id = td.disciplina_id
       JOIN trimestres tr ON tr.ano_letivo_id = COALESCE(m.ano_letivo_id, t.ano_letivo_id)
       JOIN escola_anos_letivos eal
         ON eal.escola_id = m.escola_id AND eal.ano_letivo_id = tr.ano_letivo_id
       JOIN anos_letivos al ON al.id = tr.ano_letivo_id
       LEFT JOIN notas_trimestrais nt
         ON nt.matricula_id = m.id AND nt.turma_id = t.id
        AND nt.turma_disciplina_id = td.id AND nt.trimestre_id = tr.id
        AND nt.escola_id = m.escola_id
       WHERE a.id = $1 AND m.escola_id = $2
         AND ($3::uuid IS NULL OR COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $3)
         AND ($4::uuid IS NULL OR tr.id = $4)
       ORDER BY al.ano_nome DESC, tr.numero DESC, d.nome ASC`,
      [alunoId, escolaId, anoLetivoId, trimestreId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar histórico de notas do aluno:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o histórico de notas.' });
  }
});

router.get('/relatorios/desempenho', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  try {
    const anosResult = await db.query(
      `SELECT eal.ano_letivo_id AS id, al.ano_nome,
              eal.data_inicio::text AS data_inicio,
              eal.data_fim::text AS data_fim,
              eal.ativo
       FROM escola_anos_letivos eal
       JOIN anos_letivos al ON al.id = eal.ano_letivo_id
       WHERE eal.escola_id = $1
       ORDER BY eal.ativo DESC, eal.data_inicio DESC NULLS LAST, al.ano_nome DESC`,
      [escolaId]
    );

    const anoId = req.query.ano_letivo_id ||
      anosResult.rows.find((ano) => ano.ativo)?.id ||
      anosResult.rows[0]?.id ||
      null;
    if (anoId && !UUID_PATTERN.test(anoId)) {
      return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
    }
    const ano = anosResult.rows.find((item) => item.id === anoId) || null;
    if (anoId && !ano) {
      return res.status(404).json({ success: false, message: 'O ano letivo não está associado a esta escola.' });
    }

    const trimestresResult = await db.query(
      `SELECT tr.id, tr.nome, tr.numero, tr.data_inicio::text AS data_inicio,
              tr.data_fim::text AS data_fim
       FROM trimestres tr
       JOIN escola_anos_letivos eal ON eal.ano_letivo_id = tr.ano_letivo_id
       WHERE eal.escola_id = $1
         AND ($2::uuid IS NULL OR tr.ano_letivo_id = $2)
       ORDER BY tr.numero ASC`,
      [escolaId, anoId]
    );

    const trimestreId = req.query.trimestre_id || null;
    if (trimestreId && !UUID_PATTERN.test(trimestreId)) {
      return res.status(400).json({ success: false, message: 'Trimestre inválido.' });
    }
    if (trimestreId && !trimestresResult.rows.some((item) => item.id === trimestreId)) {
      return res.status(404).json({ success: false, message: 'O trimestre não pertence ao ano letivo selecionado.' });
    }

    const [
      escolaResult,
      tesourariaResult,
      movimentosTesourariaResult,
      professoresResult,
      alunosResult,
      ramosResult,
      desempenhoTrimestresResult,
      melhoresAlunosResult,
      pagamentosResult
    ] =
      await Promise.all([
        db.query(`SELECT nome FROM escolas WHERE id = $1`, [escolaId]),
        db.query(
          `SELECT
             COUNT(*)::int AS pagamentos_total,
             COUNT(*) FILTER (WHERE tp.estado = 'aprovado')::int AS pagamentos_aprovados,
             COUNT(*) FILTER (WHERE tp.estado IN ('pendente_aprovacao', 'flagged'))::int AS pagamentos_pendentes,
             COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado = 'aprovado'), 0)::numeric AS total_arrecadado,
             COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado IN ('pendente_aprovacao', 'flagged')), 0)::numeric AS total_pendente
           FROM tesouraria_pagamentos tp
           LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
           WHERE tp.escola_id = $1
             AND (
               $2::uuid IS NULL
               OR m.ano_letivo_id = $2
               OR tp.ano_letivo_id = $2
               OR (
                 tp.matricula_id IS NULL
                 AND tp.ano_letivo_id IS NULL
                 AND $3::date IS NOT NULL
                 AND $4::date IS NOT NULL
                 AND tp.data_pagamento BETWEEN $3::date AND $4::date
               )
             )`,
          [escolaId, anoId, ano?.data_inicio || null, ano?.data_fim || null]
        ),
        db.query(
          `SELECT
             COALESCE(SUM(tm.valor) FILTER (WHERE tm.tipo = 'entrada'), 0)::numeric AS total_entradas_manuais,
             COALESCE(SUM(tm.valor) FILTER (WHERE tm.tipo = 'saida'), 0)::numeric AS total_saidas
           FROM tesouraria_movimentos tm
           WHERE tm.escola_id = $1
             AND (
               $2::uuid IS NULL
               OR tm.ano_letivo_id = $2
               OR (
                 tm.ano_letivo_id IS NULL
                 AND $3::date IS NOT NULL
                 AND $4::date IS NOT NULL
                 AND tm.data_movimento BETWEEN $3::date AND $4::date
               )
             )`,
          [escolaId, anoId, ano?.data_inicio || null, ano?.data_fim || null]
        ),
        db.query(
          `SELECT f.id, u.nome,
                  COUNT(DISTINCT td.id)::int AS disciplinas_atribuidas,
                  COUNT(DISTINCT nt.id)::int AS pautas_registadas,
                  COUNT(DISTINCT nt.matricula_id)::int AS alunos_avaliados,
                  ROUND(AVG(nt.mf)::numeric, 2) AS media_notas
           FROM funcionarios f
           JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
           JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id
             AND ae.escola_id = f.escola_id AND ae.status = 'ativo'
           JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
             AND LOWER(TRIM(pu.papel)) = 'professor'
           LEFT JOIN turma_disciplinas td ON td.professor_id = f.id
             AND td.escola_id = f.escola_id AND td.ativo = true
           LEFT JOIN notas_trimestrais nt ON nt.turma_disciplina_id = td.id
             AND nt.escola_id = f.escola_id
             AND ($2::uuid IS NULL OR nt.trimestre_id IN (
               SELECT tr.id FROM trimestres tr WHERE tr.ano_letivo_id = $2
             ))
             AND ($3::uuid IS NULL OR nt.trimestre_id = $3)
           WHERE f.escola_id = $1
           GROUP BY f.id, u.nome
           ORDER BY u.nome`,
          [escolaId, anoId, trimestreId]
        ),
        db.query(
          `WITH media_por_matricula AS (
             SELECT m.id AS matricula_id, m.aluno_id, AVG(nt.mf) AS media
             FROM matriculas m
             LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             LEFT JOIN notas_trimestrais nt ON nt.matricula_id = m.id
               AND nt.escola_id = m.escola_id
               AND ($3::uuid IS NULL OR nt.trimestre_id = $3)
               AND ($2::uuid IS NULL OR nt.trimestre_id IN (
                 SELECT tr.id FROM trimestres tr WHERE tr.ano_letivo_id = $2
               ))
             WHERE m.escola_id = $1
               AND (m.estado = 'ativa' OR ($2::uuid IS NOT NULL AND m.estado = 'concluida'))
               AND ($2::uuid IS NULL OR COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2)
             GROUP BY m.id, m.aluno_id
           )
           SELECT COUNT(*)::int AS matriculas_ativas,
                  COUNT(DISTINCT aluno_id)::int AS alunos_ativos,
                  COUNT(*) FILTER (WHERE media IS NOT NULL)::int AS alunos_com_notas,
                  COUNT(*) FILTER (WHERE media >= 10)::int AS aprovados,
                  ROUND(AVG(media)::numeric, 2) AS media_notas
           FROM media_por_matricula`,
          [escolaId, anoId, trimestreId]
        ),
        db.query(
          `SELECT p.id AS polo_id, p.nome AS ramo,
                  matriculas.matriculas,
                  matriculas.alunos,
                  candidatos.pagamentos_pendentes,
                  candidatos.aguardam_turma
           FROM polos_escola p
           LEFT JOIN LATERAL (
             SELECT COUNT(m.id)::int AS matriculas,
                    COUNT(DISTINCT m.aluno_id)::int AS alunos
             FROM matriculas m
             LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             WHERE m.escola_id = p.escola_id
               AND m.polo_id = p.id
               AND (m.estado = 'ativa' OR ($2::uuid IS NOT NULL AND m.estado = 'concluida'))
               AND ($2::uuid IS NULL OR COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2)
           ) matriculas ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE tp.estado = 'pendente_aprovacao')::int AS pagamentos_pendentes,
                    COUNT(*) FILTER (WHERE tp.estado = 'aprovado')::int AS aguardam_turma
             FROM tesouraria_pagamentos tp
             WHERE tp.escola_id = p.escola_id
               AND tp.polo_id = p.id
               AND tp.ano_letivo_id = $2
               AND tp.tipo_registo = 'candidato_novo'
               AND tp.estado IN ('pendente_aprovacao', 'aprovado')
               AND tp.aluno_id IS NULL
               AND tp.matricula_id IS NULL
               AND tp.codigo_talao IS NOT NULL
           ) candidatos ON true
           WHERE p.escola_id = $1
           ORDER BY matriculas.alunos DESC,
                    candidatos.pagamentos_pendentes DESC,
                    candidatos.aguardam_turma DESC,
                    p.nome`,
          [escolaId, anoId]
        ),
        db.query(
          `SELECT tr.id, tr.nome, tr.numero,
                  COUNT(nt.id)::int AS notas_registadas,
                  COUNT(nt.id) FILTER (WHERE nt.mf >= 10)::int AS aprovados,
                  ROUND(AVG(nt.mf)::numeric, 2) AS media_notas
           FROM trimestres tr
           JOIN escola_anos_letivos eal ON eal.ano_letivo_id = tr.ano_letivo_id
           LEFT JOIN notas_trimestrais nt ON nt.trimestre_id = tr.id
             AND nt.escola_id = eal.escola_id
           WHERE eal.escola_id = $1
             AND ($2::uuid IS NULL OR tr.ano_letivo_id = $2)
           GROUP BY tr.id, tr.nome, tr.numero
           ORDER BY tr.numero`,
          [escolaId, anoId]
        ),
        db.query(
          `WITH media_aluno AS (
             SELECT m.aluno_id, m.turma_id, t.nome AS turma_nome,
                    u.nome, a.apelido, a.foto_url,
                    ROUND(AVG(nt.mf)::numeric, 2) AS media
             FROM matriculas m
             JOIN alunos a ON a.id = m.aluno_id
             JOIN utilizadores u ON u.id = a.utilizador_id
             JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             JOIN notas_trimestrais nt ON nt.matricula_id = m.id
               AND nt.escola_id = m.escola_id
               AND ($3::uuid IS NULL OR nt.trimestre_id = $3)
               AND ($2::uuid IS NULL OR nt.trimestre_id IN (
                 SELECT tr.id FROM trimestres tr WHERE tr.ano_letivo_id = $2
               ))
             WHERE m.escola_id = $1
               AND (m.estado = 'ativa' OR ($2::uuid IS NOT NULL AND m.estado = 'concluida'))
               AND ($2::uuid IS NULL OR COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2)
             GROUP BY m.aluno_id, m.turma_id, t.nome, u.nome, a.apelido, a.foto_url
           ),
           classificados AS (
             SELECT *, ROW_NUMBER() OVER (
               PARTITION BY turma_id ORDER BY media DESC, nome, apelido
             ) AS posicao
             FROM media_aluno
             WHERE media IS NOT NULL
           )
           SELECT aluno_id, nome, apelido, foto_url, turma_nome, media, posicao
           FROM classificados
           WHERE posicao = 1
           ORDER BY media DESC, nome
           LIMIT 6`,
          [escolaId, anoId, trimestreId]
        ),
        db.query(
          `SELECT tp.id, tp.referencia_banco, tp.codigo_talao, tp.tipo_registo, tp.nome_candidato,
                  tp.valor, tp.banco_origem, tp.estado, tp.data_pagamento, tp.criado_em,
                  pt.nome AS item_nome, m.numero_matricula,
                  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.nome, a.apelido)), ''), tp.nome_candidato, 'Candidato não identificado') AS aluno_nome,
                  t.nome AS turma_nome
           FROM tesouraria_pagamentos tp
           LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
           LEFT JOIN alunos a ON a.id = m.aluno_id
           LEFT JOIN utilizadores u ON u.id = a.utilizador_id
           LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
           LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id AND pt.escola_id = tp.escola_id
           WHERE tp.escola_id = $1
             AND (
               $2::uuid IS NULL
               OR m.ano_letivo_id = $2
               OR tp.ano_letivo_id = $2
               OR (
                 tp.matricula_id IS NULL
                 AND tp.ano_letivo_id IS NULL
                 AND $3::date IS NOT NULL
                 AND $4::date IS NOT NULL
                 AND tp.data_pagamento BETWEEN $3::date AND $4::date
               )
             )
           ORDER BY tp.criado_em DESC NULLS LAST
           LIMIT 50`,
          [escolaId, anoId, ano?.data_inicio || null, ano?.data_fim || null]
        )
      ]);

    const alunos = alunosResult.rows[0] || {};
    const tesouraria = tesourariaResult.rows[0] || {};
    const movimentosTesouraria = movimentosTesourariaResult.rows[0] || {};
    const matriculasAtivas = Number(alunos.matriculas_ativas || 0);
    const alunosComNotas = Number(alunos.alunos_com_notas || 0);
    const totalEntradas = Number(tesouraria.total_arrecadado || 0) +
      Number(movimentosTesouraria.total_entradas_manuais || 0);
    const totalSaidas = Number(movimentosTesouraria.total_saidas || 0);

    return res.json({
      success: true,
      dados: {
        escola_nome: escolaResult.rows[0]?.nome || '',
        anos_letivos: anosResult.rows,
        ano_letivo: ano,
        trimestres: trimestresResult.rows,
        trimestre_id: trimestreId,
        tesouraria: {
          pagamentos_total: Number(tesouraria.pagamentos_total || 0),
          pagamentos_aprovados: Number(tesouraria.pagamentos_aprovados || 0),
          pagamentos_pendentes: Number(tesouraria.pagamentos_pendentes || 0),
          total_arrecadado: Number(tesouraria.total_arrecadado || 0),
          total_pendente: Number(tesouraria.total_pendente || 0),
          total_entradas: totalEntradas,
          total_saidas: totalSaidas,
          saldo_liquido: totalEntradas - totalSaidas
        },
        professores: professoresResult.rows.map((professor) => ({
          ...professor,
          disciplinas_atribuidas: Number(professor.disciplinas_atribuidas || 0),
          pautas_registadas: Number(professor.pautas_registadas || 0),
          alunos_avaliados: Number(professor.alunos_avaliados || 0),
          media_notas: professor.media_notas === null ? null : Number(professor.media_notas)
        })),
        alunos: {
          matriculas_ativas: matriculasAtivas,
          alunos_ativos: Number(alunos.alunos_ativos || 0),
          alunos_com_notas: alunosComNotas,
          aprovados: Number(alunos.aprovados || 0),
          media_notas: alunos.media_notas === null || alunos.media_notas === undefined
            ? null
            : Number(alunos.media_notas),
          taxa_avaliados: matriculasAtivas ? Number(((alunosComNotas / matriculasAtivas) * 100).toFixed(1)) : 0
        },
        matriculas_ramo: ramosResult.rows.map((ramo) => ({
          ...ramo,
          matriculas: Number(ramo.matriculas || 0),
          alunos: Number(ramo.alunos || 0),
          pagamentos_pendentes: Number(ramo.pagamentos_pendentes || 0),
          aguardam_turma: Number(ramo.aguardam_turma || 0)
        })),
        desempenho_trimestres: desempenhoTrimestresResult.rows.map((trimestre) => ({
          ...trimestre,
          notas_registadas: Number(trimestre.notas_registadas || 0),
          aprovados: Number(trimestre.aprovados || 0),
          media_notas: trimestre.media_notas === null ? null : Number(trimestre.media_notas)
        })),
        melhores_alunos: melhoresAlunosResult.rows.map((aluno) => ({
          ...aluno,
          media: Number(aluno.media),
          posicao: Number(aluno.posicao)
        })),
        pagamentos: pagamentosResult.rows.map((pagamento) => ({
          ...pagamento,
          valor: Number(pagamento.valor || 0)
        }))
      }
    });
  } catch (error) {
    console.error('Erro ao carregar relatório de desempenho da Direção:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar o relatório de desempenho da escola.' });
  }
});

router.get('/documentos', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;

  try {
    const resultado = await db.query(
      `SELECT d.id, d.titulo, d.tipo_documento, d.destino, d.nome_original,
              d.tipo_mime, d.tamanho_bytes, d.descricao, d.estado, d.criado_em,
              u.nome AS autor_nome
       FROM documentos_direcao d
       JOIN utilizadores u ON u.id = d.carregado_por
       WHERE d.escola_id = $1
       ORDER BY d.criado_em DESC
       LIMIT 500`,
      [escolaId]
    );
    return res.json({ success: true, total: resultado.rowCount, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar documentos da Direção:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar os documentos da Direção.' });
  }
});

router.post('/documentos', verificarAutenticacao, verificarPermissaoDirecao, receberFicheiro, async (req, res) => {
  let caminhoDocumento;
  try {
    const escolaId = escolaAtiva(req, res);
    if (!escolaId) return;

    const { titulo, tipo, destino, observacoes } = req.body || {};
    if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180 ||
        !TIPOS_DOCUMENTO.has(tipo) ||
        typeof destino !== 'string' || !destino.trim() || destino.trim().length > 180 ||
        (observacoes && (typeof observacoes !== 'string' || observacoes.length > 2000))) {
      return res.status(400).json({ success: false, message: 'Preencha tipo, título e destino com valores válidos.' });
    }
    if (!ficheiroValido(req.file)) {
      return res.status(400).json({ success: false, message: 'Anexe um PDF, DOCX ou uma imagem JPEG, PNG ou WEBP válida.' });
    }

    const extensao = path.extname(req.file.originalname).toLowerCase();
    const nomeArmazenado = `${crypto.randomUUID()}${extensao}`;
    await fs.promises.mkdir(documentosDir, { recursive: true });
    caminhoDocumento = path.join(documentosDir, nomeArmazenado);
    await fs.promises.writeFile(caminhoDocumento, req.file.buffer, { flag: 'wx' });

    const nomeOriginal = path.basename(req.file.originalname).replace(/[\r\n]/g, '').slice(0, 255);
    const resultado = await db.query(
      `INSERT INTO documentos_direcao (
         escola_id, carregado_por, titulo, tipo_documento, destino, nome_original,
         nome_armazenado, tipo_mime, tamanho_bytes, descricao, estado
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'publicado')
       RETURNING id, titulo, tipo_documento, destino, nome_original,
                 tipo_mime, tamanho_bytes, descricao, estado, criado_em`,
      [
        escolaId, req.user.id, titulo.trim(), tipo, destino.trim(), nomeOriginal,
        nomeArmazenado, MIME_POR_EXTENSAO[extensao], req.file.size, observacoes?.trim() || null
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Documento publicado e registado com sucesso.',
      dados: resultado.rows[0]
    });
  } catch (error) {
    if (caminhoDocumento) {
      await fs.promises.unlink(caminhoDocumento).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') console.error('Erro ao remover ficheiro após falha do registo:', cleanupError);
      });
    }
    console.error('Erro ao guardar documento da Direção:', error);
    return res.status(500).json({ success: false, message: 'Erro ao guardar o documento.' });
  }
});

router.get('/documentos/:id/ficheiro', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  try {
    const escolaId = escolaAtiva(req, res);
    if (!escolaId) return;

    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: 'Identificador de documento inválido.' });
    }

    const resultado = await db.query(
      `SELECT nome_armazenado, nome_original, tipo_mime
       FROM documentos_direcao
       WHERE id = $1 AND escola_id = $2`,
      [id, escolaId]
    );
    if (!resultado.rowCount) {
      return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
    }

    const documento = resultado.rows[0];
    const caminho = path.resolve(documentosDir, path.basename(documento.nome_armazenado));
    await fs.promises.access(caminho, fs.constants.R_OK);
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(documento.nome_original)}`,
      'X-Content-Type-Options': 'nosniff'
    });
    return res.type(documento.tipo_mime).sendFile(caminho);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: 'O ficheiro deste documento não está disponível.' });
    }
    console.error('Erro ao abrir documento da Direção:', error);
    return res.status(500).json({ success: false, message: 'Erro ao abrir o documento.' });
  }
});

router.get('/matriculas/pendentes', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;
  const anoLetivoId = req.query.ano_letivo_id || null;
  if (anoLetivoId && !UUID_PATTERN.test(anoLetivoId)) {
    return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
  }

  try {
    const resultado = await db.query(
      `SELECT m.id AS matricula_id, m.aluno_id, m.ano_letivo_id,
              m.numero_matricula, m.criado_em, m.turma_id,
              t.nome AS turma_nome, t.classe, p.nome AS polo_nome,
              u.nome, u.email, u.telefone, u.login_id, a.apelido, a.foto_url,
              al.ano_nome, tp.codigo_talao, tp.valor AS pagamento_valor,
              tp.estado AS pagamento_estado, tp.referencia_banco,
              anterior.matricula_id AS matricula_origem_id,
              anterior.ano_letivo_id AS ano_origem_id,
              anterior.ano_nome AS ano_origem_nome,
              COALESCE(notas.quantidade_notas, 0)::int AS quantidade_notas,
              notas.media_final,
              CASE
                WHEN anterior.matricula_id IS NULL OR COALESCE(notas.quantidade_notas, 0) = 0
                  THEN 'revisao_manual'
                WHEN notas.media_final >= 10 THEN 'aprovado'
                ELSE 'reprovado'
              END AS resultado_sugerido
       FROM matriculas m
       JOIN alunos a ON a.id = m.aluno_id
       JOIN utilizadores u ON u.id = a.utilizador_id
       JOIN anos_letivos al ON al.id = m.ano_letivo_id
       LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
       LEFT JOIN polos_escola p ON p.id = m.polo_id AND p.escola_id = m.escola_id
       LEFT JOIN tesouraria_pagamentos tp ON tp.matricula_id = m.id AND tp.escola_id = m.escola_id
       LEFT JOIN LATERAL (
         SELECT origem.id AS matricula_id, origem.ano_letivo_id, anos.ano_nome
         FROM matriculas origem
         JOIN escola_anos_letivos origem_ano
           ON origem_ano.escola_id = origem.escola_id
          AND origem_ano.ano_letivo_id = origem.ano_letivo_id
         JOIN anos_letivos anos ON anos.id = origem.ano_letivo_id
         JOIN escola_anos_letivos destino_ano
           ON destino_ano.escola_id = m.escola_id
          AND destino_ano.ano_letivo_id = m.ano_letivo_id
         WHERE origem.escola_id = m.escola_id AND origem.aluno_id = m.aluno_id
           AND origem.estado IN ('ativa', 'concluida')
           AND origem_ano.data_inicio < destino_ano.data_inicio
         ORDER BY origem_ano.data_inicio DESC, origem.criado_em DESC
         LIMIT 1
       ) anterior ON true
       LEFT JOIN LATERAL (
         SELECT ROUND(AVG(nt.mf)::numeric, 2) AS media_final, COUNT(nt.mf)::int AS quantidade_notas
         FROM notas_trimestrais nt
         WHERE nt.escola_id = m.escola_id
           AND nt.matricula_id = anterior.matricula_id
           AND nt.mf IS NOT NULL
       ) notas ON true
       WHERE m.escola_id = $1 AND m.estado = 'pendente'
         AND ($2::uuid IS NULL OR m.ano_letivo_id = $2)
       ORDER BY m.criado_em ASC`,
      [escolaId, anoLetivoId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar matrículas pendentes para decisão:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as matrículas pendentes.' });
  }
});

router.post('/matriculas/:matriculaId/decisao', verificarAutenticacao, verificarPermissaoDirecao, async (req, res) => {
  const escolaId = escolaAtiva(req, res);
  if (!escolaId) return;
  const { matriculaId } = req.params;
  const { decisao, comentario = '' } = req.body || {};
  if (!UUID_PATTERN.test(matriculaId || '')
    || !['aprovado', 'reprovado'].includes(decisao)
    || typeof comentario !== 'string'
    || comentario.trim().length > 2000) {
    return res.status(400).json({ success: false, message: 'Matrícula, decisão ou comentário inválido.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const pedido = await client.query(
      `SELECT m.id, m.aluno_id, m.ano_letivo_id, m.turma_id, a.utilizador_id
       FROM matriculas m
       JOIN alunos a ON a.id = m.aluno_id
       WHERE m.id = $1 AND m.escola_id = $2 AND m.estado = 'pendente'
       FOR UPDATE OF m, a`,
      [matriculaId, escolaId]
    );
    if (!pedido.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'A matrícula não está pendente ou já recebeu uma decisão.' });
    }

    const notaResult = await client.query(
      `SELECT origem.id AS matricula_origem_id,
              ROUND(AVG(nt.mf)::numeric, 2) AS media_final,
              COUNT(nt.mf)::int AS quantidade_notas
       FROM matriculas destino
       LEFT JOIN LATERAL (
         SELECT m.id, m.ano_letivo_id
         FROM matriculas m
         JOIN escola_anos_letivos origem_ano
           ON origem_ano.escola_id = m.escola_id
          AND origem_ano.ano_letivo_id = m.ano_letivo_id
         JOIN escola_anos_letivos destino_ano
           ON destino_ano.escola_id = destino.escola_id
          AND destino_ano.ano_letivo_id = destino.ano_letivo_id
         WHERE m.escola_id = destino.escola_id AND m.aluno_id = destino.aluno_id
           AND m.estado IN ('ativa', 'concluida')
           AND origem_ano.data_inicio < destino_ano.data_inicio
         ORDER BY origem_ano.data_inicio DESC, m.criado_em DESC
         LIMIT 1
       ) origem ON true
       LEFT JOIN notas_trimestrais nt
         ON nt.escola_id = destino.escola_id AND nt.matricula_id = origem.id AND nt.mf IS NOT NULL
       WHERE destino.id = $1
       GROUP BY origem.id`,
      [matriculaId]
    );
    const resumo = notaResult.rows[0] || { matricula_origem_id: null, media_final: null, quantidade_notas: 0 };
    const quantidadeNotas = Number(resumo.quantidade_notas || 0);
    const mediaFinal = resumo.media_final === null ? null : Number(resumo.media_final);
    const resultadoSugerido = !resumo.matricula_origem_id || quantidadeNotas === 0
      ? 'revisao_manual'
      : mediaFinal >= 10 ? 'aprovado' : 'reprovado';

    await client.query(
      `INSERT INTO matriculas_decisoes_direcao
         (matricula_id, matricula_origem_id, media_final, quantidade_notas,
          resultado_sugerido, decisao, comentario, decidido_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        matriculaId, resumo.matricula_origem_id, mediaFinal, quantidadeNotas,
        resultadoSugerido, decisao, comentario.trim(), req.user?.id || null
      ]
    );
    await client.query(
      `UPDATE matriculas
       SET estado = $1, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $2 AND escola_id = $3 AND estado = 'pendente'`,
      [decisao === 'aprovado' ? 'ativa' : 'anulada', matriculaId, escolaId]
    );
    if (decisao === 'aprovado') {
      await client.query(
        `INSERT INTO alunos_turmas (aluno_id, turma_id, ano_letivo_id, status)
         VALUES ($1, $2, $3, 'ativo')
         ON CONFLICT DO NOTHING`,
        [pedido.rows[0].aluno_id, pedido.rows[0].turma_id, pedido.rows[0].ano_letivo_id]
      );
    }
    if (resumo.matricula_origem_id) {
      await client.query(
        `UPDATE alunos_turmas
         SET status = $1
         WHERE aluno_id = $2
           AND ano_letivo_id = (SELECT ano_letivo_id FROM matriculas WHERE id = $3)
           AND status = 'ativo'`,
        [decisao === 'aprovado' ? 'promovido' : 'retido', pedido.rows[0].aluno_id, resumo.matricula_origem_id]
      );
      await client.query(
        `UPDATE matriculas SET estado = 'concluida', atualizado_em = CURRENT_TIMESTAMP
         WHERE id = $1 AND estado = 'ativa'`,
        [resumo.matricula_origem_id]
      );
    }

    let alunoRemovido = false;
    if (decisao === 'reprovado') {
      const alunoId = pedido.rows[0].aluno_id;
      const utilizadorId = pedido.rows[0].utilizador_id;
      const elegibilidade = await client.query(
        `SELECT
           NOT EXISTS (
             SELECT 1 FROM matriculas
             WHERE aluno_id = $1 AND id <> $2
           )
           AND NOT EXISTS (
             SELECT 1 FROM alunos_turmas WHERE aluno_id = $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM alunos outro
             WHERE outro.utilizador_id = $3 AND outro.id <> $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM encarregado_alunos
             WHERE utilizador_id = $3 AND aluno_id <> $1
           )
           AND NOT EXISTS (
             SELECT 1
             FROM associacoes_escola ae
             WHERE ae.utilizador_id = $3
               AND (
                 ae.escola_id <> $4
                 OR EXISTS (
                   SELECT 1 FROM papeis_utilizador pu
                   WHERE pu.associacao_id = ae.id
                     AND LOWER(TRIM(pu.papel)) <> 'aluno'
                 )
                 OR NOT EXISTS (
                   SELECT 1 FROM papeis_utilizador pu
                   WHERE pu.associacao_id = ae.id
                     AND LOWER(TRIM(pu.papel)) = 'aluno'
                 )
               )
           ) AS pode_apagar`,
        [alunoId, matriculaId, utilizadorId, escolaId]
      );

      let podeApagar = elegibilidade.rows[0]?.pode_apagar === true;
      if (podeApagar) {
        const referencias = await client.query(
          `SELECT ns.nspname AS schema_nome, tabela.relname AS tabela_nome,
                  coluna.attname AS coluna_nome
           FROM pg_constraint fk
           JOIN pg_class tabela ON tabela.oid = fk.conrelid
           JOIN pg_namespace ns ON ns.oid = tabela.relnamespace
           JOIN pg_attribute coluna
             ON coluna.attrelid = fk.conrelid AND coluna.attnum = fk.conkey[1]
           JOIN pg_attribute alvo
             ON alvo.attrelid = fk.confrelid AND alvo.attnum = fk.confkey[1]
           WHERE fk.contype = 'f'
             AND fk.confrelid = 'alunos'::regclass
             AND array_length(fk.conkey, 1) = 1
             AND array_length(fk.confkey, 1) = 1
             AND alvo.attname = 'id'`
        );
        const referenciasCompostas = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE contype = 'f'
               AND confrelid = 'alunos'::regclass
               AND (array_length(conkey, 1) > 1 OR array_length(confkey, 1) > 1)
           ) AS existe`
        );
        if (referenciasCompostas.rows[0]?.existe) podeApagar = false;

        const tabelasTratadas = new Set(['matriculas', 'alunos_turmas', 'encarregado_alunos']);
        for (const referencia of referencias.rows) {
          if (!podeApagar) break;
          if (tabelasTratadas.has(referencia.tabela_nome)) continue;
          const tabela = `${quoteIdentifier(referencia.schema_nome)}.${quoteIdentifier(referencia.tabela_nome)}`;
          const coluna = quoteIdentifier(referencia.coluna_nome);
          const ligada = await client.query(
            `SELECT EXISTS (SELECT 1 FROM ${tabela} WHERE ${coluna} = $1) AS existe`,
            [alunoId]
          );
          if (ligada.rows[0]?.existe) podeApagar = false;
        }
      }

      if (podeApagar) {
        await client.query(`DELETE FROM encarregado_alunos WHERE aluno_id = $1`, [alunoId]);
        await client.query(`DELETE FROM matriculas WHERE id = $1 AND escola_id = $2`, [matriculaId, escolaId]);
        await client.query(`DELETE FROM alunos WHERE id = $1`, [alunoId]);
        await client.query(`DELETE FROM sessoes WHERE utilizador_id = $1`, [utilizadorId]);
        await client.query(`DELETE FROM utilizadores WHERE id = $1`, [utilizadorId]);
        alunoRemovido = true;
      }
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      message: decisao === 'aprovado'
        ? 'Matrícula aprovada pela Direção.'
        : alunoRemovido
          ? 'Matrícula reprovada e os dados do aluno sem outras ligações foram removidos.'
          : 'Matrícula reprovada. O perfil do aluno foi mantido porque existem outras matrículas ou ligações.',
      dados: {
        matricula_id: matriculaId,
        decisao,
        resultado_sugerido: resultadoSugerido,
        media_final: mediaFinal,
        aluno_removido: alunoRemovido
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      console.error('Erro ao reverter decisão de matrícula:', rollbackError);
    });
    console.error('Erro ao guardar decisão de matrícula:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Esta matrícula já recebeu uma decisão da Direção.' });
    }
    return res.status(500).json({ success: false, message: 'Não foi possível guardar a decisão da Direção.' });
  } finally {
    client.release();
  }
});

module.exports = router;
