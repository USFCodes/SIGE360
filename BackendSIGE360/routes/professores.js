const express = require('express');
const router = express.Router();
const db = require('../config/db');
const verificarAutenticacao = require('../middlewares/middleware');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ESTADOS_PRESENCA = new Set(['presente', 'falta', 'atraso', 'falta_justificada']);

function dataIsoValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const dataValidada = new Date(`${data}T00:00:00.000Z`);
  return !Number.isNaN(dataValidada.getTime()) && dataValidada.toISOString().slice(0, 10) === data;
}

function verificarEscolaAtiva(req, res, escolaId) {
  if (!UUID_PATTERN.test(escolaId)) {
    res.status(400).json({ success: false, message: 'Identificador da escola inválido.' });
    return false;
  }
  if (req.contaAtiva?.escola_id !== escolaId) {
    res.status(403).json({ success: false, message: 'A escola solicitada não corresponde à conta ativa.' });
    return false;
  }
  return true;
}

async function obterProfessorAutenticado(req) {
  const escolaId = req.contaAtiva?.escola_id;
  if (!escolaId || !req.user?.id) return null;

  const resultado = await db.query(
    `SELECT f.id AS funcionario_id, f.escola_id, f.utilizador_id, u.nome
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

async function professorPodeVerTurma(professor, turmaId) {
  const resultado = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM turmas t
       WHERE t.id = $1 AND t.escola_id = $2 AND t.ativo = true
         AND (
           EXISTS (
             SELECT 1 FROM diretores_turma dt
             WHERE dt.turma_id = t.id AND dt.professor_id = $3 AND dt.data_fim IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM turma_disciplinas td
             WHERE td.turma_id = t.id AND td.escola_id = t.escola_id
               AND td.professor_id = $3 AND td.ativo = true
           )
           OR EXISTS (
             SELECT 1 FROM turmas_horarios h
             WHERE h.turma_id = t.id AND h.escola_id = t.escola_id
               AND (LOWER(TRIM(h.professor)) = LOWER(TRIM($4::text)) OR h.professor = $3::text)
           )
         )
     ) AS permitido`,
    [turmaId, professor.escola_id, professor.funcionario_id, professor.nome]
  );

  return resultado.rows[0]?.permitido === true;
}



// ============================================================
// 1. OBTER PRESENÇAS DE UMA TURMA PARA UMA DATA ESPECÍFICA
// ============================================================
router.get('/presencas/turma/:turmaId', verificarAutenticacao, async (req, res) => {
  try {
    const { turmaId } = req.params;
    const { data } = req.query;
    const professor = await obterProfessorAutenticado(req);

    if (!UUID_PATTERN.test(turmaId) || !dataIsoValida(data)) {
      return res.status(400).json({ success: false, message: 'Parâmetros inválidos (turmaId ou data).' });
    }
    if (!professor) {
      return res.status(403).json({ success: false, message: 'Professor ou escola ativa não identificados.' });
    }
    if (!await professorPodeVerTurma(professor, turmaId)) {
      return res.status(403).json({ success: false, message: 'Esta turma não está associada ao seu perfil.' });
    }

    const query = `
      SELECT 
        m.id AS matricula_id,
        a.id AS aluno_id,
        u.nome,
        a.apelido,
        m.numero_matricula,
        a.foto_url,
        p.id AS presenca_id,
        COALESCE(p.estado, 'presente') AS estado,
        p.observacoes
      FROM matriculas m
      JOIN alunos a ON a.id = m.aluno_id
      JOIN utilizadores u ON u.id = a.utilizador_id
      LEFT JOIN presencas p
        ON p.matricula_id = m.id AND p.data_presenca = $3
        AND p.escola_id = $2 AND p.turma_id = $1
      WHERE m.turma_id = $1 AND m.escola_id = $2 AND m.estado IN ('ativa', 'concluida')
      ORDER BY u.nome ASC;
    `;

    const resultado = await db.query(query, [turmaId, professor.escola_id, data]);

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao carregar presenças:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar dados de presença." });
  }
});

// ============================================================
// 2. SALVAR OU ATUALIZAR PRESENÇAS EM LOTE (BULK UPSERT)
// Rota: POST /api/v1/presencas/salvar-lote
// Body: { turma_id, data_presenca, presencas: [{ matricula_id, estado, observacoes }] }
// ============================================================
router.post('/presencas/salvar-lote', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const professor = await obterProfessorAutenticado(req);
    const { turma_id, data_presenca, presencas } = req.body || {};

    if (!professor) {
      return res.status(403).json({ success: false, message: 'Acesso negado ou escola não identificada.' });
    }
    if (!UUID_PATTERN.test(turma_id || '') || !dataIsoValida(data_presenca) || !Array.isArray(presencas) || presencas.length === 0) {
      return res.status(400).json({ success: false, message: 'Dados incompletos para submeter presenças.' });
    }
    if (!await professorPodeVerTurma(professor, turma_id)) {
      return res.status(403).json({ success: false, message: 'Esta turma não está associada ao seu perfil.' });
    }

    const matriculaIds = presencas.map((item) => item?.matricula_id);
    if (matriculaIds.some((id) => !UUID_PATTERN.test(id || ''))
      || new Set(matriculaIds).size !== matriculaIds.length
      || presencas.some((item) => !ESTADOS_PRESENCA.has(item?.estado))) {
      return res.status(400).json({ success: false, message: 'Verifique matrículas e estados de presença informados.' });
    }

    const matriculasValidas = await db.query(
      `SELECT id FROM matriculas
       WHERE id = ANY($1::uuid[]) AND escola_id = $2 AND turma_id = $3 AND estado = 'ativa'`,
      [matriculaIds, professor.escola_id, turma_id]
    );
    if (matriculasValidas.rowCount !== matriculaIds.length) {
      return res.status(400).json({ success: false, message: 'Uma ou mais matrículas não pertencem a esta turma.' });
    }

    client = await db.connect();
    await client.query('BEGIN');
    for (const item of presencas) {
      await client.query(
        `INSERT INTO presencas
          (escola_id, turma_id, matricula_id, data_presenca, registada_por, estado, observacoes, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT (matricula_id, data_presenca)
         DO UPDATE SET escola_id = EXCLUDED.escola_id,
           turma_id = EXCLUDED.turma_id,
           estado = EXCLUDED.estado,
           observacoes = EXCLUDED.observacoes,
           registada_por = EXCLUDED.registada_por,
           atualizado_em = CURRENT_TIMESTAMP`,
        [professor.escola_id, turma_id, item.matricula_id, data_presenca, professor.utilizador_id, item.estado, item.observacoes || null]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: 'Presenças guardadas com sucesso!', total: presencas.length });

  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error("Erro ao salvar presenças em lote:", error);
    return res.status(500).json({ success: false, message: "Erro ao gravar presenças no servidor." });
  } finally {
    client?.release();
  }
});


// ============================================================
// 1. LISTAR PROFESSORES DA ESCOLA COM DETALHES E DIREÇÃO DE TURMA
// ============================================================
router.get('/:escolaId/professores-detalhes', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    if (!verificarEscolaAtiva(req, res, escolaId)) return;

    const query = `
      SELECT DISTINCT
        f.id AS funcionario_id,
        u.nome,
        NULL::text AS apelido,
        u.email,
        u.telefone,
        f.foto_url,
        pu.papel,
        CASE WHEN u.status_ativo IS TRUE THEN 'Ativo' ELSE 'Inativo' END AS estado,
        t.id AS turma_diretor_id,
        t.nome AS turma_diretor_nome
      FROM funcionarios f
      JOIN utilizadores u ON u.id = f.utilizador_id
      JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
      JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'professor'
      LEFT JOIN LATERAL (
        SELECT t.id, t.nome
        FROM diretores_turma dt
        JOIN turmas t ON t.id = dt.turma_id AND t.escola_id = f.escola_id
        WHERE dt.professor_id = f.id AND dt.data_fim IS NULL
        ORDER BY dt.data_inicio DESC
        LIMIT 1
      ) t ON true
      WHERE f.escola_id = $1 AND ae.status = 'ativo'
      ORDER BY u.nome ASC;
    `;

    const resultado = await db.query(query, [escolaId]);

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar professores:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar professores." });
  }
});


// ============================================================
// 2. OBTER TURMAS, HORÁRIOS E DISCIPLINAS DE UM PROFESSOR ESPECÍFICO
// ============================================================
router.get('/:professorId/turmas-horarios', verificarAutenticacao, async (req, res) => {
  try {
    const { professorId } = req.params;
    const escolaId = req.contaAtiva?.escola_id;
    if (!UUID_PATTERN.test(professorId)) {
      return res.status(400).json({ success: false, message: 'Identificador do professor inválido.' });
    }
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa para consultar professores.' });
    }

    const professorRes = await db.query(
      `SELECT f.id AS funcionario_id, f.escola_id, u.nome
       FROM funcionarios f
       JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
       JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'professor'
       WHERE f.id = $1 AND f.escola_id = $2 AND ae.status = 'ativo'
       LIMIT 1`,
      [professorId, escolaId]
    );
    if (professorRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Professor não encontrado nesta escola.' });
    }
    const professor = professorRes.rows[0];

    const queryTurmas = `
      SELECT DISTINCT
        t.id AS turma_id,
        t.nome AS nome_turma,
        t.classe,
        t.sala,
        t.turno
      FROM turmas t
      WHERE t.escola_id = $1 AND t.ativo = true
        AND (
          EXISTS (
            SELECT 1 FROM diretores_turma dt
            WHERE dt.turma_id = t.id AND dt.professor_id = $2 AND dt.data_fim IS NULL
          )
          OR EXISTS (
            SELECT 1 FROM turma_disciplinas td
            WHERE td.turma_id = t.id AND td.escola_id = t.escola_id
              AND td.professor_id = $2 AND td.ativo = true
          )
          OR EXISTS (
            SELECT 1 FROM turmas_horarios h
            WHERE h.turma_id = t.id AND h.escola_id = t.escola_id
              AND (LOWER(TRIM(h.professor)) = LOWER(TRIM($3::text)) OR h.professor = $2::text)
          )
        )
      ORDER BY t.nome ASC`;

    const queryHorarios = `
      SELECT 
        h.id,
        h.turma_id,
        t.nome AS nome_turma,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fim,
        h.disciplina,
        h.sala
      FROM turmas_horarios h
      JOIN turmas t ON t.id = h.turma_id AND t.escola_id = h.escola_id
      WHERE h.escola_id = $1
        AND (
          LOWER(TRIM(h.professor)) = LOWER(TRIM($2::text))
          OR h.professor = $3::text
          OR EXISTS (
            SELECT 1
            FROM turma_disciplinas td
            JOIN disciplinas d ON d.id = td.disciplina_id
            WHERE td.turma_id = h.turma_id AND td.escola_id = h.escola_id
              AND td.professor_id = $4 AND td.ativo = true
              AND LOWER(TRIM(d.nome)) = LOWER(TRIM(h.disciplina))
          )
        )
      ORDER BY h.dia_semana ASC, h.hora_inicio ASC;
    `;

    const [resTurmas, resHorarios] = await Promise.all([
      db.query(queryTurmas, [escolaId, professor.funcionario_id, professor.nome]),
      db.query(queryHorarios, [escolaId, professor.nome, professor.funcionario_id, professor.funcionario_id])
    ]);

    return res.json({
      success: true,
      turmas: resTurmas.rows,
      horarios: resHorarios.rows
    });

  } catch (error) {
    console.error("Erro ao carregar dados do professor:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar detalhes do professor." });
  }
});


// ============================================================
// 3. OBTER ALUNOS DE UMA TURMA ESPECÍFICA (PARA IMPRESSÃO)
// ============================================================
router.get('/:turmaId/alunos', verificarAutenticacao, async (req, res) => {
  try {
    const { turmaId } = req.params;
    const escolaId = req.contaAtiva?.escola_id;
    if (!UUID_PATTERN.test(turmaId)) {
      return res.status(400).json({ success: false, message: 'Identificador da turma inválido.' });
    }
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa para consultar alunos.' });
    }
    const turma = await db.query(
      `SELECT id FROM turmas WHERE id = $1 AND escola_id = $2 AND ativo = true`,
      [turmaId, escolaId]
    );
    if (turma.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Turma não encontrada nesta escola.' });
    }

    const query = `
      SELECT 
        a.id AS aluno_id,
        m.numero_matricula,
        u.nome,
        a.apelido,
        a.genero,
        a.foto_url,
        encarregado.nome AS encarregado_nome,
        encarregado.telefone AS encarregado_telefone
      FROM matriculas m
      JOIN alunos a ON a.id = m.aluno_id
      JOIN utilizadores u ON u.id = a.utilizador_id
      LEFT JOIN LATERAL (
        SELECT ue.nome, ue.telefone
        FROM encarregado_alunos ea
        JOIN utilizadores ue ON ue.id = ea.utilizador_id
        WHERE ea.aluno_id = a.id
        ORDER BY ea.contacto_principal DESC, ea.criado_em DESC
        LIMIT 1
      ) encarregado ON true
      WHERE m.turma_id = $1 AND m.escola_id = $2 AND m.estado IN ('ativa', 'concluida')
      ORDER BY u.nome ASC;
    `;

    const resultado = await db.query(query, [turmaId, escolaId]);

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar alunos da turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar alunos da turma." });
  }
});

// ============================================================
// 4. OBTER PAINEL DE TURMAS DO PROFESSOR LOGADO (Diretor vs Lecionadas)
// Rota: GET /api/v1/professores/meu-painel/turmas
// ============================================================
router.get('/meu-perfil', verificarAutenticacao, async (req, res) => {
  try {
    const professor = await obterProfessorAutenticado(req);
    if (!professor) {
      return res.status(403).json({ success: false, message: 'Professor ou escola ativa não identificados.' });
    }

    const resultado = await db.query(
      `SELECT u.id AS utilizador_id, u.nome, u.email, u.telefone, u.login_id,
              u.status_ativo, f.id AS funcionario_id, f.foto_url, f.genero,
              f.morada, f.bi_ou_cedula, f.nif_pessoal, f.estado_civil,
              f.habilitacoes_literarias, f.data_nascimento, f.data_admissao,
              f.bairro, f.regiao, f.cargo,
              pd.habilitacao_literaria AS habilitacao_complementar,
              pd.especialidade, pd.regime_trabalho, pd.grau_academico,
              pd.anos_experiencia, e.nome AS escola_nome, p.nome AS polo_nome
       FROM funcionarios f
       JOIN utilizadores u ON u.id = f.utilizador_id
       JOIN escolas e ON e.id = f.escola_id
       LEFT JOIN polos_escola p ON p.id = f.polo_id AND p.escola_id = f.escola_id
       LEFT JOIN professores_detalhes pd
         ON pd.utilizador_id = f.utilizador_id AND pd.escola_id = f.escola_id
       WHERE f.id = $1 AND f.escola_id = $2
       LIMIT 1`,
      [professor.funcionario_id, professor.escola_id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Perfil do professor não encontrado.' });
    }

    return res.json({ success: true, data: resultado.rows[0] });
  } catch (error) {
    console.error('Erro ao carregar perfil do professor:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o perfil do professor.' });
  }
});

router.get('/meu-painel/turmas', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'Não existe uma escola ativa nesta sessão.' });
    }
    const professor = await obterProfessorAutenticado(req);
    if (!professor) {
      return res.status(404).json({ success: false, message: 'O utilizador autenticado não está associado como professor nesta escola.' });
    }

    const queryDiretor = `
      SELECT DISTINCT
        t.id AS turma_id,
        t.nome AS nome_turma,
        t.classe,
        t.ano_letivo_id,
        t.sala,
        t.turno,
        TRUE AS sou_diretor
      FROM turmas t
      JOIN diretores_turma dt ON dt.turma_id = t.id
      WHERE t.escola_id = $1 AND t.ativo = true
        AND dt.professor_id = $2 AND dt.data_fim IS NULL
      ORDER BY t.nome ASC`;

    const queryLecionadas = `
      SELECT DISTINCT
        t.id AS turma_id,
        t.nome AS nome_turma,
        t.classe,
        t.ano_letivo_id,
        t.sala,
        t.turno,
        FALSE AS sou_diretor
      FROM turmas t
      WHERE t.escola_id = $1 AND t.ativo = true
        AND NOT EXISTS (
          SELECT 1 FROM diretores_turma dt
          WHERE dt.turma_id = t.id AND dt.professor_id = $2 AND dt.data_fim IS NULL
        )
        AND (
          EXISTS (
            SELECT 1 FROM turma_disciplinas td
            WHERE td.turma_id = t.id AND td.escola_id = t.escola_id
              AND td.professor_id = $2 AND td.ativo = true
          )
          OR EXISTS (
            SELECT 1 FROM turmas_horarios h
            WHERE h.turma_id = t.id AND h.escola_id = t.escola_id
              AND (LOWER(TRIM(h.professor)) = LOWER(TRIM($3::text)) OR h.professor = $2::text)
          )
        )
      ORDER BY t.nome ASC`;

    const [resDiretor, resLecionadas] = await Promise.all([
      db.query(queryDiretor, [escolaId, professor.funcionario_id]),
      db.query(queryLecionadas, [escolaId, professor.funcionario_id, professor.nome])
    ]);

    return res.json({
      success: true,
      turmasDiretor: resDiretor.rows,
      turmasLecionadas: resLecionadas.rows
    });

  } catch (error) {
    console.error("Erro ao carregar painel de turmas do professor:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar turmas." });
  }
});

// ============================================================
// 5. OBTER ALUNOS DETALHADOS DE UMA TURMA PARA O PROFESSOR
// Rota: GET /api/v1/professores/turmas/:turmaId/detalhes-alunos
// ============================================================
router.get('/turmas/:turmaId/detalhes-alunos', verificarAutenticacao, async (req, res) => {
  try {
    const { turmaId } = req.params;
    const professor = await obterProfessorAutenticado(req);
    if (!UUID_PATTERN.test(turmaId)) {
      return res.status(400).json({ success: false, message: 'Identificador da turma inválido.' });
    }
    if (!professor) {
      return res.status(403).json({ success: false, message: 'Professor ou escola ativa não identificados.' });
    }
    if (!await professorPodeVerTurma(professor, turmaId)) {
      return res.status(403).json({ success: false, message: 'Esta turma não está associada ao seu perfil.' });
    }

    const query = `
      SELECT 
        a.id AS aluno_id,
        m.numero_matricula,
        u.nome,
        a.apelido,
        a.genero,
        a.foto_url,
        encarregado.nome AS encarregado_nome,
        encarregado.telefone AS encarregado_telefone
      FROM matriculas m
      JOIN alunos a ON a.id = m.aluno_id
      JOIN utilizadores u ON u.id = a.utilizador_id
      LEFT JOIN LATERAL (
        SELECT ue.nome, ue.telefone
        FROM encarregado_alunos ea
        JOIN utilizadores ue ON ue.id = ea.utilizador_id
        WHERE ea.aluno_id = a.id
        ORDER BY ea.contacto_principal DESC, ea.criado_em DESC
        LIMIT 1
      ) encarregado ON true
      WHERE m.turma_id = $1 AND m.escola_id = $2 AND m.estado IN ('ativa', 'concluida')
      ORDER BY u.nome ASC;
    `;

    const resultado = await db.query(query, [turmaId, professor.escola_id]);

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao carregar alunos da turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar alunos." });
  }
});

// ============================================================
// 5.1. OBTER ALUNOS COMPLETOS PARA O DIRETOR DE TURMA (Inclui Encarregados, Irmãos e Notas/Histórico)
// Rota: GET /api/v1/professores/turmas/:turmaId/diretor-alunos-completo
// ============================================================
router.get('/turmas/:turmaId/diretor-alunos-completo', verificarAutenticacao, async (req, res) => {
  try {
    const { turmaId } = req.params;
    const professor = await obterProfessorAutenticado(req);

    if (!UUID_PATTERN.test(turmaId)) {
      return res.status(400).json({ success: false, message: 'Identificador da turma inválido.' });
    }
    if (!professor) {
      return res.status(403).json({ success: false, message: 'Professor ou escola ativa não identificados.' });
    }

    // Verificar se o professor é realmente o Diretor desta turma
    const direcaoCheck = await db.query(
      `SELECT 1
       FROM diretores_turma dt
       JOIN turmas t ON t.id = dt.turma_id
       WHERE dt.turma_id = $1 AND dt.professor_id = $2
         AND dt.data_fim IS NULL AND t.escola_id = $3 AND t.ativo = true`,
      [turmaId, professor.funcionario_id, professor.escola_id]
    );

    if (direcaoCheck.rowCount === 0) {
      return res.status(403).json({ success: false, message: 'Não tem permissões de Diretor de Turma para aceder a estes dados completos.' });
    }

    // Load only each student's latest active enrollment in this class.
    const queryAlunos = `
      WITH matricula_atual AS (
        SELECT DISTINCT ON (m.aluno_id) m.*
        FROM matriculas m
        WHERE m.turma_id = $1 AND m.escola_id = $2 AND m.estado IN ('ativa', 'concluida')
        ORDER BY m.aluno_id, m.data_matricula DESC NULLS LAST, m.criado_em DESC
      )
      SELECT
        a.id AS aluno_id,
        m.numero_matricula,
        u.nome,
        u.login_id,
        u.email,
        u.telefone,
        a.apelido,
        a.genero,
        a.foto_url,
        a.data_nascimento,
        a.numero_identificacao,
        a.nacionalidade,
        a.regiao_origem,
        a.local_origem,
        a.regiao_morada,
        a.setor_morada,
        a.endereco_morada,
        a.ultima_nota,
        a.ultima_escola_frequentada AS escola_anterior,
        m.id AS matricula_id,
        m.data_matricula,
        m.estado AS estado_matricula,
        m.observacoes AS observacoes_matricula,
        ano.ano_nome,
        t.id AS turma_id,
        t.nome AS turma_nome,
        t.classe,
        t.turno,
        t.sala,
        polo.nome AS polo_nome,
        encarregado.nome AS encarregado_nome,
        encarregado.telefone AS encarregado_telefone,
        encarregado.email AS encarregado_email,
        encarregado.id AS encarregado_id,
        encarregado.parentesco AS encarregado_parentesco,
        encarregado.ocupacao AS encarregado_ocupacao,
        encarregado.morada AS encarregado_morada
      FROM matricula_atual m
      JOIN alunos a ON a.id = m.aluno_id
      JOIN utilizadores u ON u.id = a.utilizador_id
      JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
      LEFT JOIN polos_escola polo ON polo.id = m.polo_id AND polo.escola_id = m.escola_id
      LEFT JOIN anos_letivos ano ON ano.id = m.ano_letivo_id
      LEFT JOIN LATERAL (
        SELECT ue.id, ue.nome, ue.telefone, ue.email, ea.parentesco,
               ea.occupacao AS ocupacao,
               concat_ws(' / ', ea.regiao_morada, ea.setor_morada) AS morada
        FROM encarregado_alunos ea 
        JOIN utilizadores ue ON ue.id = ea.utilizador_id 
        WHERE ea.aluno_id = a.id 
        ORDER BY ea.contacto_principal DESC, ea.criado_em DESC 
        LIMIT 1
      ) encarregado ON true
      ORDER BY u.nome ASC;
    `;

    const resultadoAlunos = await db.query(queryAlunos, [turmaId, professor.escola_id]);
    const alunos = resultadoAlunos.rows;
    const alunoIds = alunos.map((aluno) => aluno.aluno_id);
    let irmaos = [];
    let notas = [];
    let frequencias = [];
    let frequenciasRecentes = [];

    if (alunoIds.length > 0) {
      const [resIrmaos, resNotas, resFrequencias, resFrequenciasRecentes] = await Promise.all([
        db.query(
          `SELECT DISTINCT
             base.aluno_id AS referencia_id,
             irmao.id AS aluno_id,
             u.nome,
             irmao.apelido,
             t.nome AS turma_nome
           FROM encarregado_alunos base
           JOIN encarregado_alunos ligacao ON ligacao.utilizador_id = base.utilizador_id
             AND ligacao.aluno_id <> base.aluno_id
           JOIN alunos irmao ON irmao.id = ligacao.aluno_id
           JOIN utilizadores u ON u.id = irmao.utilizador_id
           JOIN matriculas m ON m.aluno_id = irmao.id
             AND m.escola_id = $2 AND m.estado = 'ativa'
           LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
           WHERE base.aluno_id = ANY($1::uuid[])
           ORDER BY referencia_id, u.nome`,
          [alunoIds, professor.escola_id]
        ),
        db.query(
          `WITH notas_recentes AS (
             SELECT m.aluno_id, d.nome AS disciplina, tr.nome AS trimestre_nome,
                    tr.numero AS trimestre_numero, al.ano_nome,
                    nt.n1, nt.n2, nt.n3, nt.n4, nt.mac, nt.prova_final, nt.mf,
                    row_number() OVER (
                      PARTITION BY m.aluno_id
                      ORDER BY tr.data_fim DESC NULLS LAST, tr.numero DESC,
                               nt.atualizado_em DESC NULLS LAST, d.nome ASC
                    ) AS posicao
             FROM notas_trimestrais nt
             JOIN matriculas m ON m.id = nt.matricula_id
               AND m.escola_id = $2 AND m.turma_id = $3
             JOIN turma_disciplinas td ON td.id = nt.turma_disciplina_id
               AND td.turma_id = nt.turma_id AND td.escola_id = nt.escola_id
             JOIN disciplinas d ON d.id = td.disciplina_id
             JOIN trimestres tr ON tr.id = nt.trimestre_id
             JOIN anos_letivos al ON al.id = tr.ano_letivo_id
             JOIN escola_anos_letivos eal ON eal.ano_letivo_id = tr.ano_letivo_id
               AND eal.escola_id = nt.escola_id
             WHERE nt.escola_id = $2 AND nt.turma_id = $3
               AND m.aluno_id = ANY($1::uuid[])
           )
           SELECT aluno_id,
             jsonb_agg(jsonb_build_object(
               'disciplina', disciplina, 'trimestre_nome', trimestre_nome,
               'trimestre_numero', trimestre_numero, 'ano_nome', ano_nome,
               'n1', n1, 'n2', n2, 'n3', n3, 'n4', n4,
               'mac', mac, 'prova_final', prova_final, 'mf', mf
             ) ORDER BY posicao) AS notas
           FROM notas_recentes WHERE posicao <= 20 GROUP BY aluno_id`,
          [alunoIds, professor.escola_id, turmaId]
        ),
        db.query(
          `SELECT m.aluno_id, p.estado, COUNT(*)::int AS total,
                  MAX(p.data_presenca) AS ultima_data
           FROM presencas p
           JOIN matriculas m ON m.id = p.matricula_id
           WHERE p.escola_id = $2 AND p.turma_id = $3
             AND m.aluno_id = ANY($1::uuid[])
           GROUP BY m.aluno_id, p.estado
           ORDER BY m.aluno_id, p.estado`,
          [alunoIds, professor.escola_id, turmaId]
        ),
        db.query(
          `WITH presencas_recentes AS (
             SELECT m.aluno_id, p.data_presenca, p.estado, p.observacoes,
                    row_number() OVER (
                      PARTITION BY m.aluno_id ORDER BY p.data_presenca DESC, p.criado_em DESC
                    ) AS posicao
             FROM presencas p
             JOIN matriculas m ON m.id = p.matricula_id
             WHERE p.escola_id = $2 AND p.turma_id = $3
               AND m.aluno_id = ANY($1::uuid[])
           )
           SELECT aluno_id,
             jsonb_agg(jsonb_build_object(
               'data_presenca', data_presenca, 'estado', estado, 'observacoes', observacoes
             ) ORDER BY data_presenca DESC) AS registos
           FROM presencas_recentes WHERE posicao <= 8 GROUP BY aluno_id`,
          [alunoIds, professor.escola_id, turmaId]
        )
      ]);
      irmaos = resIrmaos.rows;
      notas = resNotas.rows;
      frequencias = resFrequencias.rows;
      frequenciasRecentes = resFrequenciasRecentes.rows;
    }

    const dadosPorAluno = new Map(alunos.map((aluno) => [aluno.aluno_id, {
      irmaos: [],
      notas: [],
      frequencia_resumo: [],
      frequencia_recente: []
    }]));
    irmaos.forEach((irmao) => dadosPorAluno.get(irmao.referencia_id)?.irmaos.push(irmao));
    notas.forEach((nota) => {
      const dados = dadosPorAluno.get(nota.aluno_id);
      if (dados) dados.notas = nota.notas || [];
    });
    frequencias.forEach((frequencia) => {
      dadosPorAluno.get(frequencia.aluno_id)?.frequencia_resumo.push(frequencia);
    });
    frequenciasRecentes.forEach((frequencia) => {
      const dados = dadosPorAluno.get(frequencia.aluno_id);
      if (dados) dados.frequencia_recente = frequencia.registos || [];
    });
    const alunosEnriquecidos = alunos.map((aluno) => ({
      ...aluno,
      ...dadosPorAluno.get(aluno.aluno_id)
    }));

    return res.json({
      success: true,
      total: alunosEnriquecidos.length,
      dados: alunosEnriquecidos
    });

  } catch (error) {
    console.error("Erro ao carregar dados completos do diretor de turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar detalhes completos da turma." });
  }
});

// -------------------------------------------------------------
// ============================================================
// ROTA: DADOS DO PAINEL DO PROFESSOR (GET)
// ============================================================
router.get('/meu-painel/dados', verificarAutenticacao, async (req, res) => {
    try {
        const professor = await obterProfessorAutenticado(req);
        if (!professor) {
            return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        }

        let anoLetivoId = req.query.ano_letivo_id ? String(req.query.ano_letivo_id) : null;
        if (anoLetivoId && !UUID_PATTERN.test(anoLetivoId)) {
            return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
        }
        if (anoLetivoId) {
            const anoAssociado = await db.query(
                `SELECT 1 FROM escola_anos_letivos
                 WHERE escola_id = $1 AND ano_letivo_id = $2
                 LIMIT 1`,
                [professor.escola_id, anoLetivoId]
            );
            if (!anoAssociado.rows.length) {
                return res.status(400).json({ success: false, message: 'Ano letivo não associado à escola.' });
            }
        } else {
            const anoAtivo = await db.query(
                `SELECT ano_letivo_id
                 FROM escola_anos_letivos
                 WHERE escola_id = $1
                 ORDER BY ativo DESC, data_inicio DESC NULLS LAST
                 LIMIT 1`,
                [professor.escola_id]
            );
            anoLetivoId = anoAtivo.rows[0]?.ano_letivo_id || null;
        }

        const [turmasRes, horariosRes, indicadoresRes, avisosRes] = await Promise.all([
          db.query(
            `SELECT DISTINCT t.id, t.nome AS nome_turma, t.classe, t.sala, t.turno,
                    (SELECT COUNT(*) FROM matriculas m
                     WHERE m.turma_id = t.id AND m.escola_id = t.escola_id
                       AND (m.estado = 'ativa' OR ($5::uuid IS NOT NULL AND m.estado = 'concluida'))
                       AND ($5::uuid IS NULL OR m.ano_letivo_id = $5::uuid)) AS total_alunos
                    , EXISTS (
                      SELECT 1 FROM diretores_turma dt
                      WHERE dt.turma_id = t.id AND dt.professor_id = $1 AND dt.data_fim IS NULL
                    ) AS sou_diretor,
                    COALESCE((
                      SELECT string_agg(DISTINCT disciplinas.nome, ', ' ORDER BY disciplinas.nome)
                      FROM (
                        SELECT d.nome
                        FROM turma_disciplinas td
                        JOIN disciplinas d ON d.id = td.disciplina_id
                        WHERE td.turma_id = t.id AND td.escola_id = t.escola_id
                          AND td.professor_id = $1 AND td.ativo = true
                        UNION
                        SELECT h.disciplina AS nome
                        FROM turmas_horarios h
                        WHERE h.turma_id = t.id AND h.escola_id = t.escola_id
                          AND (LOWER(TRIM(h.professor)) = LOWER(TRIM($3::text))
                               OR h.professor = $4::text)
                      ) disciplinas
                    ), '') AS disciplinas
             FROM turmas t
             WHERE t.escola_id = $2 AND t.ativo = true
               AND ($5::uuid IS NULL OR t.ano_letivo_id = $5::uuid)
               AND (
                 EXISTS (
                   SELECT 1 FROM diretores_turma dt
                   WHERE dt.turma_id = t.id AND dt.professor_id = $1 AND dt.data_fim IS NULL
                 )
                 OR EXISTS (
                   SELECT 1 FROM turma_disciplinas td
                   WHERE td.turma_id = t.id AND td.escola_id = t.escola_id
                     AND td.professor_id = $1 AND td.ativo = true
                 )
                 OR EXISTS (
                   SELECT 1 FROM turmas_horarios h
                   WHERE h.turma_id = t.id AND h.escola_id = t.escola_id
                     AND (LOWER(TRIM(h.professor)) = LOWER(TRIM($3::text))
                          OR h.professor = $4::text)
                 )
               )
             ORDER BY t.nome ASC`,
            [professor.funcionario_id, professor.escola_id, professor.nome, professor.funcionario_id, anoLetivoId]
          ),
          db.query(
            `SELECT h.id::text, h.dia_semana, h.hora_inicio, h.hora_fim,
                    h.disciplina, h.sala, t.id AS turma_id, t.nome AS nome_turma, t.classe
             FROM turmas_horarios h
             JOIN turmas t ON t.id = h.turma_id AND t.escola_id = h.escola_id
             WHERE h.escola_id = $2 AND t.ativo = true
               AND ($5::uuid IS NULL OR t.ano_letivo_id = $5::uuid)
               AND (
                 LOWER(TRIM(h.professor)) = LOWER(TRIM($3::text))
                 OR h.professor = $4::text
                 OR EXISTS (
                   SELECT 1
                   FROM turma_disciplinas td
                   JOIN disciplinas d ON d.id = td.disciplina_id
                   WHERE td.turma_id = h.turma_id AND td.escola_id = h.escola_id
                     AND td.professor_id = $1 AND td.ativo = true
                     AND LOWER(TRIM(d.nome)) = LOWER(TRIM(h.disciplina))
                 )
               )
             ORDER BY CASE LOWER(h.dia_semana)
                        WHEN 'segunda-feira' THEN 1 WHEN 'terça-feira' THEN 2
                        WHEN 'quarta-feira' THEN 3 WHEN 'quinta-feira' THEN 4
                        WHEN 'sexta-feira' THEN 5 WHEN 'sábado' THEN 6
                        WHEN 'domingo' THEN 7 ELSE 8
                      END,
                      h.hora_inicio ASC
             LIMIT 8`,
            [professor.funcionario_id, professor.escola_id, professor.nome, professor.funcionario_id, anoLetivoId]
          ),
          db.query(
            `WITH turmas_professor AS (
               SELECT t.id AS turma_id
               FROM turmas t
               WHERE t.escola_id = $2 AND t.ativo = true
                 AND ($5::uuid IS NULL OR t.ano_letivo_id = $5::uuid)
                 AND (
                   EXISTS (
                     SELECT 1 FROM diretores_turma dt
                     WHERE dt.turma_id = t.id AND dt.professor_id = $1 AND dt.data_fim IS NULL
                   )
                   OR EXISTS (
                     SELECT 1 FROM turma_disciplinas td
                     WHERE td.turma_id = t.id AND td.escola_id = t.escola_id
                       AND td.professor_id = $1 AND td.ativo = true
                   )
                   OR EXISTS (
                     SELECT 1 FROM turmas_horarios h
                     WHERE h.turma_id = t.id AND h.escola_id = t.escola_id
                       AND (LOWER(TRIM(h.professor)) = LOWER(TRIM($3::text))
                            OR h.professor = $4::text)
                   )
                 )
             ),
             resumo AS (
               SELECT COUNT(DISTINCT (p.turma_id, p.data_presenca))::int AS aulas_lecionadas,
                      COUNT(*) FILTER (WHERE p.estado IN ('presente', 'atraso'))::int AS presencas,
                      COUNT(*)::int AS total_registos
               FROM presencas p
               JOIN turmas_professor tp ON tp.turma_id = p.turma_id
               WHERE p.escola_id = $2
             )
             SELECT aulas_lecionadas,
                    CASE WHEN total_registos = 0 THEN 0
                         ELSE ROUND(100.0 * presencas / total_registos, 1)
                    END AS media_assiduidade
             FROM resumo`,
            [professor.funcionario_id, professor.escola_id, professor.nome, professor.funcionario_id, anoLetivoId]
          ),
          db.query(
            `SELECT n.id::text, n.titulo, n.mensagem,
                    TO_CHAR(n.data_hora, 'DD/MM/YYYY HH24:MI') AS hora
             FROM platform_notifications n
             WHERE n.recipient_user_ids @> ARRAY[$2::uuid]
                OR (n.escola_id = $1 AND 'professor' = ANY(n.destinatarios))
             ORDER BY n.data_hora DESC, n.id DESC
             LIMIT 5`,
            [professor.escola_id, professor.utilizador_id]
          )
        ]);

        const notasRes = turmasRes.rows.length
          ? await db.query(
            `WITH periodos AS (
               SELECT tr.id, tr.nome, tr.numero, al.ano_nome
               FROM escola_anos_letivos eal
               JOIN trimestres tr ON tr.ano_letivo_id = eal.ano_letivo_id
               JOIN anos_letivos al ON al.id = tr.ano_letivo_id
               WHERE eal.escola_id = $1
                 AND ($3::uuid IS NULL OR eal.ano_letivo_id = $3::uuid)
                 AND tr.ativo = true
             ),
             medias AS (
               SELECT nt.turma_id, nt.trimestre_id, ROUND(AVG(nt.mf), 2)::numeric AS media
               FROM notas_trimestrais nt
               WHERE nt.escola_id = $1
                 AND nt.turma_id = ANY($2::uuid[])
                 AND nt.trimestre_id IN (SELECT id FROM periodos)
                 AND nt.mf IS NOT NULL
               GROUP BY nt.turma_id, nt.trimestre_id
             )
             SELECT p.id AS trimestre_id, p.nome AS trimestre_nome, p.numero AS trimestre_numero,
                    p.ano_nome, t.id AS turma_id, t.nome AS nome_turma, t.classe, m.media
             FROM periodos p
             CROSS JOIN turmas t
             LEFT JOIN medias m ON m.turma_id = t.id AND m.trimestre_id = p.id
             WHERE t.id = ANY($2::uuid[])
             ORDER BY p.numero ASC, t.nome ASC`,
            [professor.escola_id, turmasRes.rows.map((turma) => turma.id), anoLetivoId]
          )
          : { rows: [] };
        const parametrosNotasRes = await db.query(
          `SELECT escala_nota FROM parametros_avaliacao WHERE escola_id = $1 LIMIT 1`,
          [professor.escola_id]
        );
        const escalaNota = parametrosNotasRes.rows[0]?.escala_nota || '0-20';
        const cotacaoMaxima = Number(String(escalaNota).split('-')[1]) || 20;

        const seriesNotas = turmasRes.rows.map((turma, index) => ({
            dataKey: `turma${index}`,
            nome: turma.classe ? `${turma.nome_turma} (${turma.classe})` : turma.nome_turma
        }));
        const periodosNotas = new Map();
        const seriePorTurma = new Map(turmasRes.rows.map((turma, index) => [turma.id, `turma${index}`]));
        for (const nota of notasRes.rows) {
            const chavePeriodo = nota.trimestre_id;
            if (!periodosNotas.has(chavePeriodo)) {
                periodosNotas.set(chavePeriodo, {
                    periodo: `${nota.trimestre_nome} · ${nota.ano_nome}`
                });
            }
            if (nota.media !== null) {
                periodosNotas.get(chavePeriodo)[seriePorTurma.get(nota.turma_id)] = Number(nota.media);
            }
        }

        const turmasLecionadas = turmasRes.rows.map(t => ({
            id: t.id,
            nome: t.classe ? `${t.nome_turma} (${t.classe})` : t.nome_turma,
            sala: t.sala || 'Sala não definida',
            turno: t.turno || 'Turno não definido',
            alunos: Number(t.total_alunos) || 0,
            disciplinas: t.disciplinas || '',
            papel: t.sou_diretor ? 'Diretor de turma' : 'Professor'
        }));

        const totalTurmas = turmasLecionadas.length;
        const totalAlunos = turmasLecionadas.reduce((acc, t) => acc + t.alunos, 0);
        const indicadores = indicadoresRes.rows[0] || {};

        return res.json({
            success: true,
            data: {
                nomeProfessor: professor.nome,
                disciplinaPrincipal: 'Corpo Docente',
                kpiRows: [
                    { nome: 'Turmas Atribuídas', value: totalTurmas, color: 'blue' },
                    { nome: 'Total de Alunos', value: totalAlunos, color: 'purple' },
                    { nome: 'Aulas Lecionadas', value: Number(indicadores.aulas_lecionadas || 0), color: 'green' },
                    { nome: 'Média de Assiduidade', value: `${Number(indicadores.media_assiduidade || 0).toFixed(1)}%`, color: 'yellow' }
                ],
                turmasLecionadas,
                horarios: horariosRes.rows,
                graficoNotas: [...periodosNotas.values()],
                seriesNotas,
                cotacaoMaxima,
                avisosPedagogicos: avisosRes.rows.map((aviso) => ({
                    id: aviso.id,
                    title: aviso.titulo,
                    time: aviso.hora,
                    mensagem: aviso.mensagem
                }))
            }
        });

    } catch (error) {
        console.error('Erro ao carregar painel do professor:', error);
        return res.status(500).json({ success: false, message: 'Erro interno ao carregar painel.' });
    }
});
// ============================================================
// ROTA: LISTAR TODAS AS TURMAS DA ESCOLA (Para a Direção)
// GET /api/v1/direcao/turmas
// ============================================================
router.get('/turmas', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const query = `
            SELECT id, nome, classe, turno, sala, capacidade 
            FROM turmas 
            WHERE escola_id = $1 AND ativo = true 
            ORDER BY classe ASC, nome ASC;
        `;
        const resultado = await db.query(query, [escolaId]);
        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error("Erro ao listar turmas para a direção:", error);
        return res.status(500).json({ success: false, message: "Erro ao carregar turmas." });
    }
});

// ============================================================
// ROTA: BROADSHEET / PAUTA GERAL PARA A DIREÇÃO DA ESCOLA
// GET /api/v1/professores/pauta-geral?turma_id=...&turma_disciplina_id=...&trimestre_id=...
// ============================================================
router.get('/pauta-geral', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { turma_id, turma_disciplina_id, trimestre_id } = req.query;

        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        if (!turma_id || !turma_disciplina_id || !trimestre_id) {
            return res.status(400).json({ success: false, message: 'Turma, Disciplina e Trimestre são obrigatórios.' });
        }
        if (![turma_id, turma_disciplina_id, trimestre_id].every((id) => UUID_PATTERN.test(id))) {
            return res.status(400).json({ success: false, message: 'Turma, Disciplina ou Trimestre inválido.' });
        }

        const contexto = await db.query(
            `SELECT EXISTS (
               SELECT 1
               FROM turmas t
               JOIN turma_disciplinas td
                 ON td.id = $2 AND td.turma_id = t.id AND td.escola_id = t.escola_id
               JOIN trimestres tr ON tr.id = $3
               JOIN escola_anos_letivos eal
                 ON eal.ano_letivo_id = tr.ano_letivo_id AND eal.escola_id = t.escola_id
               WHERE t.id = $1 AND t.escola_id = $4
             ) AS permitido`,
            [turma_id, turma_disciplina_id, trimestre_id, escolaId]
        );
        if (contexto.rows[0]?.permitido !== true) {
            return res.status(404).json({ success: false, message: 'A turma, disciplina ou trimestre não pertence a esta escola.' });
        }

        const query = `
            SELECT 
                m.id AS matricula_id,
                a.id AS aluno_id,
                m.numero_matricula,
                u.nome,
                a.apelido,
                t.nome AS turma_nome,
                t.classe,
                d.nome AS disciplina_nome,
                nt.n1, nt.n2, nt.n3, nt.n4,
                nt.mac,
                nt.prova_final,
                nt.mf,
                encarregado.nome AS encarregado_nome,
                encarregado.telefone AS encarregado_telefone
            FROM matriculas m
            JOIN alunos a ON a.id = m.aluno_id
            JOIN utilizadores u ON u.id = a.utilizador_id
            JOIN turmas t ON t.id = m.turma_id
            JOIN turma_disciplinas td ON td.turma_id = t.id AND td.escola_id = t.escola_id AND td.id = $2
            LEFT JOIN disciplinas d ON d.id = td.disciplina_id
            LEFT JOIN notas_trimestrais nt ON nt.matricula_id = m.id 
                AND nt.turma_disciplina_id = $2 
                AND nt.trimestre_id = $3
                AND nt.turma_id = t.id
                AND nt.escola_id = $4
            LEFT JOIN LATERAL (
                SELECT ue.nome, ue.telefone 
                FROM encarregado_alunos ea 
                JOIN utilizadores ue ON ue.id = ea.utilizador_id 
                WHERE ea.aluno_id = a.id 
                ORDER BY ea.contacto_principal DESC, ea.criado_em DESC 
                LIMIT 1
            ) encarregado ON true
            WHERE m.turma_id = $1 AND m.escola_id = $4 AND m.estado IN ('ativa', 'concluida')
            ORDER BY u.nome ASC;
        `;

        const resultado = await db.query(query, [turma_id, turma_disciplina_id, trimestre_id, escolaId]);
        
        let alunos = resultado.rows;

        // Ordenar por Média Final (MF) para calcular a posição na turma automaticamente[cite: 1]
        alunos.sort((a, b) => (Number(b.mf) || 0) - (Number(a.mf) || 0));

        const alunosComPosicao = alunos.map((aluno, index) => ({
            ...aluno,
            posicao_turma: index + 1
        }));

        return res.json({ success: true, dados: alunosComPosicao });

    } catch (error) {
        console.error("Erro ao carregar pauta geral da direção:", error);
        return res.status(500).json({ success: false, message: "Erro interno ao carregar pauta geral." });
    }
});

module.exports = router;