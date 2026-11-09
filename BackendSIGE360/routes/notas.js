const express = require('express');
const router = express.Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');

const upload = multer({ storage: multer.memoryStorage() });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Auxiliary function to validate authenticated teacher
async function obterProfessorAutenticado(req) {
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId || !req.user?.id) return null;

    const resultado = await db.query(
        `SELECT f.id AS funcionario_id, f.escola_id, f.utilizador_id, u.nome
         FROM funcionarios f
         JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
         JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
         WHERE f.utilizador_id = $1 AND f.escola_id = $2 AND ae.status = 'ativo' AND LOWER(TRIM(pu.papel)) = 'professor'
         LIMIT 1`,
        [req.user.id, escolaId]
    );

    return resultado.rows[0] || null;
}

// Auxiliary function to check access to class
async function professorPodeAcederTurma(professor, turmaId) {
    const resultado = await db.query(
        `SELECT EXISTS (
            SELECT 1 FROM turmas t
            WHERE t.id = $1 AND t.escola_id = $2 AND t.ativo = true AND (
                EXISTS (SELECT 1 FROM diretores_turma dt WHERE dt.turma_id = t.id AND dt.professor_id = $3 AND dt.data_fim IS NULL)
                OR EXISTS (SELECT 1 FROM turma_disciplinas td WHERE td.turma_id = t.id AND td.escola_id = t.escola_id AND td.professor_id = $3 AND td.ativo = true)
            )
        ) AS permitido`,
        [turmaId, professor.escola_id, professor.funcionario_id]
    );
    return resultado.rows[0]?.permitido === true;
}

async function professorPodeConsultarTurma(professor, turmaId) {
    const resultado = await db.query(
        `SELECT EXISTS (
            SELECT 1 FROM turmas t
            WHERE t.id = $1 AND t.escola_id = $2 AND t.ativo = true AND (
                EXISTS (SELECT 1 FROM diretores_turma dt WHERE dt.turma_id = t.id AND dt.professor_id = $3 AND dt.data_fim IS NULL)
                OR EXISTS (SELECT 1 FROM turma_disciplinas td WHERE td.turma_id = t.id AND td.escola_id = t.escola_id AND td.professor_id = $3 AND td.ativo = true)
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

async function professorPodeEditarDisciplina(professor, turmaId, turmaDisciplinaId, trimestreId, permitirAnoEncerrado = false) {
    const resultado = await db.query(
        `SELECT EXISTS (
           SELECT 1
           FROM turmas t
           JOIN turma_disciplinas td
             ON td.turma_id = t.id AND td.escola_id = t.escola_id
           JOIN trimestres tr ON tr.id = $4 AND tr.ano_letivo_id = t.ano_letivo_id
           JOIN escola_anos_letivos eal
             ON eal.escola_id = t.escola_id AND eal.ano_letivo_id = tr.ano_letivo_id
           WHERE t.id = $1 AND t.escola_id = $5 AND t.ativo = true
             AND ($6::boolean = true OR eal.ativo = true)
             AND td.id = $2 AND td.ativo = true
             AND (
               td.professor_id = $3
               OR EXISTS (
                 SELECT 1 FROM diretores_turma dt
                 WHERE dt.turma_id = t.id AND dt.professor_id = $3 AND dt.data_fim IS NULL
               )
             )
         ) AS permitido`,
        [turmaId, turmaDisciplinaId, professor.funcionario_id, trimestreId, professor.escola_id, permitirAnoEncerrado]
    );
    return resultado.rows[0]?.permitido === true;
}

// Auxiliary function to calculate MAC and MF
function calcularMedias(n1, n2, n3, n4, prova_final, cotacaoMaxima = 20) {
    const notasValidas = [n1, n2, n3, n4].map(v => (v !== null && v !== undefined && v !== '' && !isNaN(v)) ? Number(v) : null);
    const notasPresentes = notasValidas.filter(v => v !== null);

    let mac = null;
    if (notasPresentes.length > 0) {
        const soma = notasPresentes.reduce((acc, curr) => acc + curr, 0);
        mac = parseFloat((soma / notasPresentes.length).toFixed(2));
    }

    const pfValida = (prova_final !== null && prova_final !== undefined && prova_final !== '' && !isNaN(prova_final)) ? Number(prova_final) : null;
    let mf = null;

    if (mac !== null && pfValida !== null) {
        mf = parseFloat(((mac + pfValida) / 2).toFixed(2));
    } else if (mac !== null) {
        mf = mac; // Se ainda não tem prova final, a MF temporária é a MAC
    }

    return { mac, pfValida, mf };
}

// ============================================================
// 1. LISTAR TRIMESTRES / SEMESTRES
// ============================================================
router.get('/anos-letivos', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!UUID_PATTERN.test(escolaId || '')) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

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
        console.error('Erro ao listar anos letivos:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível carregar os anos letivos.' });
    }
});

router.get('/trimestres', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!UUID_PATTERN.test(escolaId || '')) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        const anoLetivoId = req.query.ano_letivo_id || null;
        if (anoLetivoId && !UUID_PATTERN.test(anoLetivoId)) {
            return res.status(400).json({ success: false, message: 'Identificador do ano letivo inválido.' });
        }
        if (anoLetivoId) {
            const anoAssociado = await db.query(
                `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
                [escolaId, anoLetivoId]
            );
            if (anoAssociado.rowCount === 0) {
                return res.status(404).json({ success: false, message: 'Ano letivo não associado a esta escola.' });
            }
        }

        const [resultado, parametros] = await Promise.all([
            db.query(
                `SELECT DISTINCT tr.id, tr.nome, tr.numero, tr.ano_letivo_id, tr.data_inicio, tr.data_fim, al.ano_nome
                 FROM trimestres tr
                 JOIN escola_anos_letivos eal ON eal.ano_letivo_id = tr.ano_letivo_id
                 JOIN anos_letivos al ON al.id = tr.ano_letivo_id
                 LEFT JOIN parametros_avaliacao pa ON pa.escola_id = eal.escola_id
                 WHERE eal.escola_id = $1
                   AND ($2::uuid IS NOT NULL OR eal.ativo = true)
                   AND ($2::uuid IS NULL OR eal.ano_letivo_id = $2)
                   AND (tr.ativo = true OR (eal.ativo = false AND $2::uuid IS NOT NULL))
                   AND tr.numero <= CASE WHEN pa.sistema_periodo = 'semestres' THEN 2 ELSE 3 END
                 ORDER BY al.ano_nome DESC, tr.numero ASC`,
                [escolaId, anoLetivoId]
            ),
            db.query(`SELECT sistema_periodo, escala_nota, tipo_prova_final FROM parametros_avaliacao WHERE escola_id = $1 LIMIT 1`, [escolaId])
        ]);

        const escalaNota = parametros.rows[0]?.escala_nota || '0-20';
        const cotacaoMaxima = Number(escalaNota.split('-')[1]) || 20;

        return res.json({
            success: true,
            dados: resultado.rows,
            sistema_periodo: parametros.rows[0]?.sistema_periodo || 'trimestres',
            tipo_prova_final: parametros.rows[0]?.tipo_prova_final || 'trimestres',
            escala_nota: escalaNota,
            cotacao_maxima: cotacaoMaxima
        });
    } catch (error) {
        console.error('Erro ao listar trimestres:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível carregar os períodos letivos.' });
    }
});

router.get('/turmas/:turmaId/disciplinas', verificarAutenticacao, async (req, res) => {
    try {
        const { turmaId } = req.params;
        const professor = await obterProfessorAutenticado(req);

        if (!UUID_PATTERN.test(turmaId || '')) {
            return res.status(400).json({ success: false, message: 'Identificador da turma inválido.' });
        }
        if (!professor) {
            return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        }
        if (!await professorPodeAcederTurma(professor, turmaId)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta turma.' });
        }

        const resultado = await db.query(
            `SELECT td.id AS turma_disciplina_id, d.nome
             FROM turma_disciplinas td
             JOIN disciplinas d ON d.id = td.disciplina_id
             WHERE td.turma_id = $1 AND td.escola_id = $2 AND td.ativo = true
               AND (
                 td.professor_id = $3
                 OR EXISTS (
                   SELECT 1 FROM diretores_turma dt
                   WHERE dt.turma_id = td.turma_id AND dt.professor_id = $3 AND dt.data_fim IS NULL
                 )
               )
             ORDER BY d.nome ASC`,
            [turmaId, professor.escola_id, professor.funcionario_id]
        );

        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error('Erro ao carregar disciplinas da turma:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível carregar as disciplinas da turma.' });
    }
});

// ============================================================
// 2. OBTER GRELHA DE NOTAS DA TURMA (N1, N2, N3, N4, MAC, PF, MF)
// ============================================================
router.get('/grelha', verificarAutenticacao, async (req, res) => {
    try {
        const { turma_id, turma_disciplina_id, trimestre_id } = req.query;
        const professor = await obterProfessorAutenticado(req);

        if (!professor) return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        if (!UUID_PATTERN.test(turma_id || '') || !UUID_PATTERN.test(turma_disciplina_id || '') || !UUID_PATTERN.test(trimestre_id || '')) {
            return res.status(400).json({ success: false, message: 'Parâmetros de busca inválidos.' });
        }

        if (!await professorPodeEditarDisciplina(professor, turma_id, turma_disciplina_id, trimestre_id, true)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta disciplina ou período.' });
        }

        const query = `
            SELECT 
                m.id AS matricula_id,
                m.numero_matricula,
                u.nome,
                a.apelido,
                CASE WHEN nt.id IS NOT NULL AND (
                    nt.n1 IS NOT NULL OR nt.n2 IS NOT NULL OR nt.n3 IS NOT NULL
                    OR nt.n4 IS NOT NULL OR nt.prova_final IS NOT NULL
                ) THEN nt.id END AS nota_id,
                nt.n1, nt.n2, nt.n3, nt.n4,
                nt.mac,
                nt.prova_final,
                nt.mf,
                COALESCE(ap.estado, 'pendente') AS estado_aprovacao_direcao,
                COALESCE(ap.comentario, '') AS comentario_direcao
            FROM matriculas m
            JOIN alunos a ON a.id = m.aluno_id
            JOIN utilizadores u ON u.id = a.utilizador_id
            LEFT JOIN notas_trimestrais nt ON nt.matricula_id = m.id
                AND nt.escola_id = m.escola_id AND nt.turma_id = m.turma_id
                AND nt.turma_disciplina_id = $1 
                AND nt.trimestre_id = $2
            LEFT JOIN direcao_aprovacoes_notas ap
                ON ap.escola_id = m.escola_id AND ap.matricula_id = m.id
                AND ap.turma_disciplina_id = $1 AND ap.trimestre_id = $2
            WHERE m.turma_id = $3 AND m.escola_id = $4 AND m.estado IN ('ativa', 'concluida')
            ORDER BY u.nome ASC;
        `;

        const resultado = await db.query(query, [turma_disciplina_id, trimestre_id, turma_id, professor.escola_id]);
        return res.json({ success: true, dados: resultado.rows });

    } catch (error) {
        console.error("Erro ao carregar grelha de notas:", error);
        return res.status(500).json({ success: false, message: "Erro ao carregar grelha de notas." });
    }
});

// ============================================================
// 3. GRAVAR NOTAS DIRETAMENTE DO ECRÃ (EM LOTE)
// ============================================================
router.post('/salvar-grelha', verificarAutenticacao, async (req, res) => {
    let client;
    try {
        const professor = await obterProfessorAutenticado(req);
        const { turma_id, turma_disciplina_id, trimestre_id, notas } = req.body || {};

        if (!professor) return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        if (!UUID_PATTERN.test(turma_id || '') || !UUID_PATTERN.test(turma_disciplina_id || '') || !UUID_PATTERN.test(trimestre_id || '') || !Array.isArray(notas)) {
            return res.status(400).json({ success: false, message: 'Dados de submissão inválidos.' });
        }

        if (notas.length === 0 || notas.length > 5000
            || !notas.every((item) => UUID_PATTERN.test(item?.matricula_id || ''))) {
            return res.status(400).json({ success: false, message: 'A lista de notas é inválida.' });
        }
        if (new Set(notas.map((item) => item.matricula_id)).size !== notas.length) {
            return res.status(400).json({ success: false, message: 'A lista contém matrículas repetidas.' });
        }
        if (!await professorPodeEditarDisciplina(professor, turma_id, turma_disciplina_id, trimestre_id)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta disciplina ou período.' });
        }
        const matriculas = await db.query(
            `SELECT m.id
             FROM matriculas m
             JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             JOIN trimestres tr ON tr.id = $4
             WHERE m.id = ANY($1::uuid[]) AND m.turma_id = $2 AND m.escola_id = $3
               AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = tr.ano_letivo_id
               AND m.estado = 'ativa'`,
            [notas.map((item) => item.matricula_id), turma_id, professor.escola_id, trimestre_id]
        );
        if (matriculas.rowCount !== notas.length) {
            return res.status(400).json({ success: false, message: 'Uma ou mais matrículas não pertencem a esta pauta.' });
        }

        client = await db.connect();
        await client.query('BEGIN');

        for (const item of notas) {
            const { matricula_id, n1, n2, n3, n4, prova_final } = item;
            const { mac, pfValida, mf } = calcularMedias(n1, n2, n3, n4, prova_final);

            const queryUpsert = `
                INSERT INTO notas_trimestrais (
                    escola_id, turma_id, turma_disciplina_id, trimestre_id, matricula_id,
                    n1, n2, n3, n4, mac, prova_final, mf, registado_por, atualizado_em
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
                ON CONFLICT (matricula_id, turma_disciplina_id, trimestre_id)
                DO UPDATE SET
                    n1 = EXCLUDED.n1,
                    n2 = EXCLUDED.n2,
                    n3 = EXCLUDED.n3,
                    n4 = EXCLUDED.n4,
                    mac = EXCLUDED.mac,
                    prova_final = EXCLUDED.prova_final,
                    mf = EXCLUDED.mf,
                    registado_por = EXCLUDED.registado_por,
                    atualizado_em = CURRENT_TIMESTAMP;
            `;

            await client.query(queryUpsert, [
                professor.escola_id, turma_id, turma_disciplina_id, trimestre_id, matricula_id,
                n1 ?? null, n2 ?? null, n3 ?? null, n4 ?? null, mac, pfValida, mf, req.user.id
            ]);
            const submeteuNotas = [n1, n2, n3, n4, prova_final]
                .some((nota) => nota !== null && nota !== undefined && String(nota).trim() !== '');
            if (submeteuNotas) {
                await client.query(
                    `INSERT INTO direcao_aprovacoes_notas
                       (escola_id, matricula_id, turma_disciplina_id, trimestre_id, estado, comentario, atualizado_por)
                     VALUES ($1, $2, $3, $4, 'pendente', '', $5)
                     ON CONFLICT (escola_id, matricula_id, turma_disciplina_id, trimestre_id)
                     DO UPDATE SET estado = 'pendente', comentario = '',
                                   atualizado_por = EXCLUDED.atualizado_por,
                                   atualizado_em = CURRENT_TIMESTAMP`,
                    [professor.escola_id, matricula_id, turma_disciplina_id, trimestre_id, req.user.id]
                );
            } else {
                await client.query(
                    `DELETE FROM direcao_aprovacoes_notas
                     WHERE escola_id = $1 AND matricula_id = $2
                       AND turma_disciplina_id = $3 AND trimestre_id = $4`,
                    [professor.escola_id, matricula_id, turma_disciplina_id, trimestre_id]
                );
            }
        }

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Notas e médias guardadas com sucesso!' });

    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error("Erro ao guardar notas da grelha:", error);
        return res.status(500).json({ success: false, message: "Erro ao guardar notas." });
    } finally {
        client?.release();
    }
});

// ============================================================
// 4. EXPORTAR PAUTA EXCEL SIMPLES (N1, N2, N3, N4, PF, MAC E MF)
// ============================================================
router.get('/exportar-modelo', verificarAutenticacao, async (req, res) => {
    try {
        const { turma_id, turma_disciplina_id, trimestre_id } = req.query;
        const professor = await obterProfessorAutenticado(req);

        if (!professor) return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        if (![turma_id, turma_disciplina_id, trimestre_id].every((id) => UUID_PATTERN.test(id || ''))) {
            return res.status(400).json({ success: false, message: 'Parâmetros de exportação inválidos.' });
        }
        if (!await professorPodeEditarDisciplina(professor, turma_id, turma_disciplina_id, trimestre_id)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta disciplina ou período.' });
        }

        const contexto = await db.query(
            `SELECT al.ano_nome, t.nome AS turma_nome, d.nome AS disciplina_nome
             FROM turmas t
             JOIN anos_letivos al ON al.id = t.ano_letivo_id
             JOIN turma_disciplinas td
               ON td.id = $2 AND td.turma_id = t.id AND td.escola_id = t.escola_id
             JOIN disciplinas d ON d.id = td.disciplina_id
             JOIN trimestres tr ON tr.id = $3 AND tr.ano_letivo_id = t.ano_letivo_id
             WHERE t.id = $1 AND t.escola_id = $4`,
            [turma_id, turma_disciplina_id, trimestre_id, professor.escola_id]
        );
        if (!contexto.rowCount) {
            return res.status(404).json({ success: false, message: 'Não foi possível encontrar os dados desta turma.' });
        }

        const queryAlunos = `
            SELECT m.id AS matricula_id, m.numero_matricula, u.nome, a.apelido,
                   nt.n1, nt.n2, nt.n3, nt.n4, nt.prova_final
            FROM matriculas m
            JOIN alunos a ON a.id = m.aluno_id
            JOIN utilizadores u ON u.id = a.utilizador_id
            LEFT JOIN notas_trimestrais nt ON nt.matricula_id = m.id 
                AND nt.escola_id = m.escola_id AND nt.turma_id = m.turma_id
                AND nt.turma_disciplina_id = $1 AND nt.trimestre_id = $2
            WHERE m.turma_id = $3 AND m.escola_id = $4 AND m.estado IN ('ativa', 'concluida')
            ORDER BY u.nome ASC, a.apelido ASC;
        `;

        const resultado = await db.query(queryAlunos, [turma_disciplina_id, trimestre_id, turma_id, professor.escola_id]);
        const dados = contexto.rows[0];
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SIGE360';
        workbook.subject = `Pauta de ${dados.disciplina_nome} · ${dados.turma_nome}`;
        workbook.created = new Date();
        workbook.calcProperties = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true };

        const worksheet = workbook.addWorksheet('Pauta de Notas', {
            properties: { defaultRowHeight: 20 },
            pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        worksheet.columns = [
            { key: 'sn', width: 7 },
            { key: 'aluno', width: 34 },
            { key: 'n1', width: 10 },
            { key: 'n2', width: 10 },
            { key: 'n3', width: 10 },
            { key: 'n4', width: 10 },
            { key: 'mac', width: 11 },
            { key: 'prova_final', width: 11 },
            { key: 'mf', width: 11 },
            { key: 'matricula_id', width: 38, hidden: true }
        ];

        for (const [label, value] of [
            ['Turma', dados.turma_nome],
            ['Disciplina', dados.disciplina_nome],
            ['Ano letivo', dados.ano_nome]
        ]) {
            const row = worksheet.addRow([]);
            worksheet.mergeCells(row.number, 1, row.number, 2);
            row.getCell(1).value = `${label}: ${value || ''}`;
        }
        worksheet.addRow([]);
        const cabecalho = worksheet.addRow(['SN', 'Nomes', 'N1', 'N2', 'N3', 'N4', 'MAC', 'PF', 'MF', 'Matricula_ID']);
        cabecalho.font = { bold: true };
        worksheet.getColumn(10).hidden = true;

        resultado.rows.forEach((aluno, index) => {
            const rowNumber = index + 6;
            const row = worksheet.addRow([
                index + 1,
                `${aluno.nome} ${aluno.apelido || ''}`.trim(),
                aluno.n1 ?? '',
                aluno.n2 ?? '',
                aluno.n3 ?? '',
                aluno.n4 ?? '',
                { formula: `IF(COUNT(C${rowNumber}:F${rowNumber})=0,"",ROUND(AVERAGE(C${rowNumber}:F${rowNumber}),2))` },
                aluno.prova_final ?? '',
                { formula: `IF(G${rowNumber}="","",IF(H${rowNumber}="",G${rowNumber},ROUND(AVERAGE(G${rowNumber},H${rowNumber}),2)))` },
                aluno.matricula_id
            ]);
            for (const column of [3, 4, 5, 6, 7, 8, 9]) {
                row.getCell(column).numFmt = '0.00';
            }
        });

        if (resultado.rowCount) {
            worksheet.autoFilter = { from: 'A5', to: `I${resultado.rowCount + 5}` };
        }
        worksheet.views = [{ state: 'frozen', ySplit: 4, activeCell: 'A5' }];

        const excelBuffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename=pauta_notas_${turma_id}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return res.send(excelBuffer);

    } catch (error) {
        console.error("Erro ao exportar modelo Excel:", error);
        return res.status(500).json({ success: false, message: "Erro ao exportar modelo Excel." });
    }
});

// ============================================================
// 5. IMPORTAR NOTAS VIA UPLOAD DE EXCEL (.XLSX)
// ============================================================
router.post('/importar-excel', verificarAutenticacao, upload.single('ficheiro'), async (req, res) => {
    let client;
    try {
        const professor = await obterProfessorAutenticado(req);
        const { turma_id, turma_disciplina_id, trimestre_id } = req.body || {};

        if (!professor || !req.file) {
            return res.status(400).json({ success: false, message: 'Ficheiro ou professor inválidos.' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            return res.status(400).json({ success: false, message: 'O ficheiro Excel não contém uma folha de cálculo.' });
        }
        const worksheet = workbook.Sheets[sheetName];
        const linhasExcel = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        const normalizarCabecalho = (valor) => String(valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
        const linhaCabecalho = linhasExcel.findIndex((linha) => {
            const colunas = linha.map(normalizarCabecalho);
            return colunas.includes('MATRICULA_ID')
                && ['N1', 'N2', 'N3', 'N4', 'PROVA_FINAL', 'PFL', 'PF'].some((coluna) => colunas.includes(coluna));
        });
        if (linhaCabecalho < 0) {
            return res.status(400).json({ success: false, message: 'Não foi encontrado o cabeçalho de notas esperado no ficheiro Excel.' });
        }
        const cabecalhos = linhasExcel[linhaCabecalho].map(normalizarCabecalho);
        const indicesColunas = {
            matricula_id: cabecalhos.indexOf('MATRICULA_ID'),
            n1: cabecalhos.indexOf('N1'),
            n2: cabecalhos.indexOf('N2'),
            n3: cabecalhos.indexOf('N3'),
            n4: cabecalhos.indexOf('N4'),
            prova_final: ['PROVA_FINAL', 'PFL', 'PF'].map((coluna) => cabecalhos.indexOf(coluna)).find((indice) => indice >= 0)
        };
        const obterValorColuna = (linha, indice) => indice === undefined || indice < 0 ? '' : linha[indice];
        const lerNota = (valor, nomeColuna) => {
            if (valor === '' || valor === null || valor === undefined) return null;
            const numero = typeof valor === 'number' ? valor : Number(String(valor).trim().replace(',', '.'));
            if (!Number.isFinite(numero) || numero < 0 || numero > 20) {
                throw new Error(`A nota ${nomeColuna} deve ser um número entre 0 e 20.`);
            }
            return numero;
        };
        const rows = linhasExcel.slice(linhaCabecalho + 1)
            .filter((linha) => linha.some((valor) => String(valor).trim() !== ''))
            .map((linha) => ({
                matricula_id: obterValorColuna(linha, indicesColunas.matricula_id),
                n1: obterValorColuna(linha, indicesColunas.n1),
                n2: obterValorColuna(linha, indicesColunas.n2),
                n3: obterValorColuna(linha, indicesColunas.n3),
                n4: obterValorColuna(linha, indicesColunas.n4),
                prova_final: obterValorColuna(linha, indicesColunas.prova_final)
            }));

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'O ficheiro Excel está vazio.' });
        }
        if (rows.length > 5000 || ![turma_id, turma_disciplina_id, trimestre_id].every((id) => UUID_PATTERN.test(id || ''))) {
            return res.status(400).json({ success: false, message: 'Os dados da pauta são inválidos ou excedem o limite permitido.' });
        }
        let notasImportadas;
        try {
            notasImportadas = rows.map((row) => ({
                matricula_id: row.matricula_id,
                n1: lerNota(row.n1, 'N1'),
                n2: lerNota(row.n2, 'N2'),
                n3: lerNota(row.n3, 'N3'),
                n4: lerNota(row.n4, 'N4'),
                prova_final: lerNota(row.prova_final, 'Prova Final')
            }));
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
        notasImportadas = notasImportadas.filter((row) => (
            [row.n1, row.n2, row.n3, row.n4, row.prova_final]
                .some((nota) => nota !== null && nota !== undefined)
        ));
        if (notasImportadas.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Não foram encontradas notas preenchidas. Confirme N1–N4 ou PF antes de importar.'
            });
        }
        if (!await professorPodeEditarDisciplina(professor, turma_id, turma_disciplina_id, trimestre_id)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta disciplina ou período.' });
        }
        const matriculaIds = notasImportadas.map((row) => row.matricula_id);
        if (!matriculaIds.every((id) => UUID_PATTERN.test(id || ''))
            || new Set(matriculaIds).size !== matriculaIds.length) {
            return res.status(400).json({ success: false, message: 'O ficheiro contém identificadores de matrícula inválidos ou repetidos.' });
        }
        const matriculasValidas = await db.query(
            `SELECT m.id
             FROM matriculas m
             JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             JOIN trimestres tr ON tr.id = $4
             WHERE m.id = ANY($1::uuid[]) AND m.turma_id = $2 AND m.escola_id = $3
               AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = tr.ano_letivo_id`,
            [matriculaIds, turma_id, professor.escola_id, trimestre_id]
        );
        if (matriculasValidas.rowCount !== matriculaIds.length) {
            return res.status(400).json({ success: false, message: 'O ficheiro contém alunos fora desta pauta.' });
        }

        client = await db.connect();
        await client.query('BEGIN');

        let aprovacoesCriadas = 0;
        for (const row of notasImportadas) {
            const { matricula_id, n1, n2, n3, n4 } = row;
            const pf = row.prova_final;

            const { mac, pfValida, mf } = calcularMedias(n1, n2, n3, n4, pf);

            const queryUpsert = `
                INSERT INTO notas_trimestrais (
                    escola_id, turma_id, turma_disciplina_id, trimestre_id, matricula_id,
                    n1, n2, n3, n4, mac, prova_final, mf, registado_por, atualizado_em
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
                ON CONFLICT (matricula_id, turma_disciplina_id, trimestre_id)
                DO UPDATE SET
                    n1 = EXCLUDED.n1, n2 = EXCLUDED.n2, n3 = EXCLUDED.n3, n4 = EXCLUDED.n4,
                    mac = EXCLUDED.mac, prova_final = EXCLUDED.prova_final, mf = EXCLUDED.mf,
                    registado_por = EXCLUDED.registado_por, atualizado_em = CURRENT_TIMESTAMP;
            `;

            await client.query(queryUpsert, [
                professor.escola_id, turma_id, turma_disciplina_id, trimestre_id, matricula_id,
                n1, n2, n3, n4, mac, pfValida, mf, req.user.id
            ]);
            const submeteuNotas = [n1, n2, n3, n4, pf]
                .some((nota) => nota !== null && nota !== undefined && String(nota).trim() !== '');
            if (submeteuNotas) {
                await client.query(
                    `INSERT INTO direcao_aprovacoes_notas
                       (escola_id, matricula_id, turma_disciplina_id, trimestre_id, estado, comentario, atualizado_por)
                     VALUES ($1, $2, $3, $4, 'pendente', '', $5)
                     ON CONFLICT (escola_id, matricula_id, turma_disciplina_id, trimestre_id)
                     DO UPDATE SET estado = 'pendente', comentario = '',
                                   atualizado_por = EXCLUDED.atualizado_por,
                                   atualizado_em = CURRENT_TIMESTAMP`,
                    [professor.escola_id, matricula_id, turma_disciplina_id, trimestre_id, req.user.id]
                );
                aprovacoesCriadas += 1;
            } else {
                await client.query(
                    `DELETE FROM direcao_aprovacoes_notas
                     WHERE escola_id = $1 AND matricula_id = $2
                       AND turma_disciplina_id = $3 AND trimestre_id = $4`,
                    [professor.escola_id, matricula_id, turma_disciplina_id, trimestre_id]
                );
            }
        }

        await client.query('COMMIT');
        return res.json({
            success: true,
            message: `Importação concluída: ${notasImportadas.length} alunos atualizados e ${aprovacoesCriadas} enviados para aprovação da Direção.`,
            dados: { alunos_atualizados: notasImportadas.length, enviados_para_aprovacao: aprovacoesCriadas }
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error("Erro ao importar notas via Excel:", error);
        return res.status(500).json({ success: false, message: "Erro ao importar ficheiro." });
    } finally {
        client?.release();
    }
});

router.get('/aluno/:alunoId/ficha', verificarAutenticacao, async (req, res) => {
    try {
        const { alunoId } = req.params;
        const { turma_id, trimestre_id } = req.query;
        const professor = await obterProfessorAutenticado(req);

        if (!UUID_PATTERN.test(alunoId || '') || !UUID_PATTERN.test(turma_id || '')
            || (trimestre_id && !UUID_PATTERN.test(trimestre_id))) {
            return res.status(400).json({ success: false, message: 'Identificadores do aluno, turma ou trimestre inválidos.' });
        }
        if (!professor) {
            return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        }
        if (!await professorPodeConsultarTurma(professor, turma_id)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta turma.' });
        }

        const resultadoFicha = await db.query(
            `SELECT a.id AS aluno_id, a.apelido, a.genero, a.foto_url,
                    a.data_nascimento, a.numero_identificacao, a.nacionalidade,
                    a.ultima_escola_frequentada AS escola_anterior,
                    u.nome, u.email, u.telefone,
                    m.id AS matricula_id, m.numero_matricula, m.data_matricula,
                    m.observacoes AS observacoes_matricula,
                    t.id AS turma_id, t.nome AS turma_nome, t.classe, t.turno,
                    al.ano_nome, polo.nome AS polo_nome, polo.telefone AS polo_telefone,
                    e.nome AS escola_nome, e.sigla AS escola_sigla,
                    e.logo_url AS escola_logo_url, e.motto AS escola_motto,
                    e.endereco AS escola_endereco, e.cor_primaria AS escola_cor_primaria,
                    diretor.nome AS diretor_turma
             FROM matriculas m
             JOIN alunos a ON a.id = m.aluno_id
             JOIN utilizadores u ON u.id = a.utilizador_id
             JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             JOIN escolas e ON e.id = m.escola_id
             LEFT JOIN anos_letivos al ON al.id = m.ano_letivo_id
             LEFT JOIN polos_escola polo ON polo.id = m.polo_id AND polo.escola_id = m.escola_id
             LEFT JOIN LATERAL (
               SELECT ud.nome
               FROM diretores_turma dt
               JOIN funcionarios fd ON fd.id = dt.professor_id
               JOIN utilizadores ud ON ud.id = fd.utilizador_id
               WHERE dt.turma_id = t.id AND dt.data_fim IS NULL
               ORDER BY dt.data_inicio DESC NULLS LAST
               LIMIT 1
             ) diretor ON true
             WHERE a.id = $1 AND t.id = $2 AND m.escola_id = $3
               AND m.estado IN ('ativa', 'concluida')
             ORDER BY m.data_matricula DESC NULLS LAST, m.criado_em DESC
             LIMIT 1`,
            [alunoId, turma_id, professor.escola_id]
        );

        if (resultadoFicha.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Não foi encontrada uma matrícula deste aluno nesta turma.' });
        }

        const ficha = resultadoFicha.rows[0];
        const [resultadoDisciplinas, resultadoPresencas] = await Promise.all([
            db.query(
                `SELECT d.nome, nt.n1, nt.n2, nt.n3, nt.n4, nt.mac,
                        nt.prova_final, nt.mf, tr.nome AS trimestre_nome,
                        tr.numero AS trimestre_numero, al.ano_nome
                 FROM notas_trimestrais nt
                 JOIN turma_disciplinas td ON td.id = nt.turma_disciplina_id
                   AND td.turma_id = nt.turma_id AND td.escola_id = nt.escola_id
                 JOIN disciplinas d ON d.id = td.disciplina_id
                 JOIN trimestres tr ON tr.id = nt.trimestre_id
                 JOIN anos_letivos al ON al.id = tr.ano_letivo_id
                 WHERE nt.matricula_id = $1 AND nt.escola_id = $2 AND nt.turma_id = $3
                   AND ($4::uuid IS NULL OR nt.trimestre_id = $4)
                 ORDER BY al.ano_nome DESC, tr.numero DESC, d.nome ASC`,
                [ficha.matricula_id, professor.escola_id, turma_id, trimestre_id || null]
            ),
            db.query(
                `SELECT
                   COUNT(*) FILTER (WHERE LOWER(TRIM(estado)) = 'falta_justificada')::int AS faltas_justificadas,
                   COUNT(*) FILTER (WHERE LOWER(TRIM(estado)) = 'falta')::int AS faltas_injustificadas
                 FROM presencas
                 WHERE matricula_id = $1 AND escola_id = $2 AND turma_id = $3`,
                [ficha.matricula_id, professor.escola_id, turma_id]
            )
        ]);

        return res.json({
            success: true,
            dados: {
                escola: {
                    nome: ficha.escola_nome,
                    sigla: ficha.escola_sigla,
                    logo_url: ficha.escola_logo_url,
                    motto: ficha.escola_motto,
                    endereco: ficha.escola_endereco,
                    telefone: ficha.polo_telefone
                },
                aluno: {
                    aluno_id: ficha.aluno_id,
                    nome: ficha.nome,
                    apelido: ficha.apelido,
                    email: ficha.email,
                    telefone: ficha.telefone,
                    genero: ficha.genero,
                    foto_url: ficha.foto_url,
                    data_nascimento: ficha.data_nascimento,
                    numero_identificacao: ficha.numero_identificacao,
                    nacionalidade: ficha.nacionalidade,
                    escola_anterior: ficha.escola_anterior,
                    numero_matricula: ficha.numero_matricula
                },
                turma: {
                    turma_id: ficha.turma_id,
                    nome: ficha.turma_nome,
                    classe: ficha.classe,
                    turno: ficha.turno,
                    diretor_turma: ficha.diretor_turma,
                    ano_nome: ficha.ano_nome
                },
                disciplinas: resultadoDisciplinas.rows,
                extras: {
                    observacoes: ficha.observacoes_matricula || '',
                    faltas_justificadas: resultadoPresencas.rows[0]?.faltas_justificadas || 0,
                    faltas_injustificadas: resultadoPresencas.rows[0]?.faltas_injustificadas || 0,
                    comportamento: null
                }
            }
        });
    } catch (error) {
        console.error('Erro ao carregar ficha trimestral do aluno:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível carregar a ficha do aluno.' });
    }
});

router.post('/aluno/:alunoId/extras', verificarAutenticacao, async (req, res) => {
    try {
        const { alunoId } = req.params;
        const { turma_id, observacoes } = req.body || {};
        const professor = await obterProfessorAutenticado(req);

        if (!UUID_PATTERN.test(alunoId || '') || !UUID_PATTERN.test(turma_id || '')
            || typeof observacoes !== 'string' || observacoes.length > 5000) {
            return res.status(400).json({ success: false, message: 'Aluno, turma ou observações inválidos.' });
        }
        if (!professor) {
            return res.status(403).json({ success: false, message: 'Professor não identificado.' });
        }
        if (!await professorPodeConsultarTurma(professor, turma_id)) {
            return res.status(403).json({ success: false, message: 'Acesso negado a esta turma.' });
        }

        const matricula = await db.query(
            `SELECT id FROM matriculas
             WHERE aluno_id = $1 AND turma_id = $2 AND escola_id = $3 AND estado = 'ativa'
             ORDER BY data_matricula DESC NULLS LAST, criado_em DESC
             LIMIT 1`,
            [alunoId, turma_id, professor.escola_id]
        );
        if (matricula.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Matrícula ativa do aluno não encontrada nesta turma.' });
        }

        await db.query(
            `UPDATE matriculas
             SET observacoes = $1, atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $2 AND escola_id = $3`,
            [observacoes.trim() || null, matricula.rows[0].id, professor.escola_id]
        );

        return res.json({ success: true, message: 'Observações guardadas com sucesso.' });
    } catch (error) {
        console.error('Erro ao guardar observações da ficha do aluno:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível guardar as observações.' });
    }
});

module.exports = router;