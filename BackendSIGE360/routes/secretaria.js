const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const verificarAutenticacao = require('../middlewares/middleware');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const documentosDir = path.resolve(__dirname, '../private_uploads/documentos');
const tiposDocumento = new Set(['declaracao', 'certificado', 'historico', 'guia_transferencia', 'atestado', 'outro']);
const extensoesDocumento = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx']);
const mimePorExtensao = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const uploadDocumento = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

function validarFicheiroDocumento(file) {
  if (!file) return false;
  const extensao = path.extname(file.originalname).toLowerCase();
  const buffer = file.buffer;
  if (!extensoesDocumento.has(extensao)) return false;

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

function receberFicheiroDocumento(req, res, next) {
  uploadDocumento.single('ficheiro')(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE'
      ? 'O ficheiro excede o limite de 15 MB.'
      : 'Não foi possível receber o ficheiro enviado.' });
  });
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

router.get('/dashboard', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa.' });
    }

    const anosResult = await db.query(
      `SELECT eal.ano_letivo_id AS id, al.ano_nome,
              eal.data_inicio::text AS data_inicio, eal.data_fim::text AS data_fim,
              eal.ativo
       FROM escola_anos_letivos eal
       JOIN anos_letivos al ON al.id = eal.ano_letivo_id
       WHERE eal.escola_id = $1
       ORDER BY eal.ativo DESC, eal.data_inicio DESC NULLS LAST, al.ano_nome DESC`,
      [escolaId]
    );
    const anoId = req.query.ano_letivo_id ||
      anosResult.rows.find((item) => item.ativo)?.id ||
      anosResult.rows[0]?.id ||
      null;
    if (anoId && !UUID_PATTERN.test(anoId)) {
      return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
    }
    const ano = anosResult.rows.find((item) => item.id === anoId) || null;
    if (anoId && !ano) {
      return res.status(404).json({ success: false, message: 'O ano letivo não está associado a esta escola.' });
    }
    const intervaloValido = req.query.todos !== 'true'
      && Boolean(ano?.data_inicio && ano?.data_fim && ano.data_inicio <= ano.data_fim);

    const [
      escolaResult,
      alunosResult,
      turmasResult,
      professoresResult,
      tesourariaResult,
      evolucaoFinanceiraResult,
      pagamentosEstadoResult,
      polosResult,
      alocacoesTalaoResult
    ] =
      await Promise.all([
        db.query(`SELECT id, nome FROM escolas WHERE id = $1`, [escolaId]),
        db.query(
          `SELECT COUNT(DISTINCT m.aluno_id)::int AS total
           FROM matriculas m
           WHERE m.escola_id = $1 AND m.estado = 'ativa'
             AND ($2::uuid IS NULL OR m.ano_letivo_id = $2)`,
          [escolaId, ano?.id || null]
        ),
        db.query(
          `SELECT COUNT(*)::int AS total
           FROM turmas
           WHERE escola_id = $1 AND ativo = true`,
          [escolaId]
        ),
        db.query(
          `SELECT COUNT(DISTINCT f.id)::int AS total
           FROM funcionarios f
           JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
           JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id
             AND ae.escola_id = f.escola_id AND ae.status = 'ativo'
           JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
             AND LOWER(TRIM(pu.papel)) = 'professor'
           WHERE f.escola_id = $1`,
          [escolaId]
        ),
        db.query(
          `SELECT
             COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado = 'aprovado'), 0)::numeric AS receita_aprovada,
             COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado IN ('pendente_aprovacao', 'flagged')), 0)::numeric AS receita_pendente,
             COUNT(*) FILTER (WHERE tp.estado IN ('pendente_aprovacao', 'flagged'))::int AS pagamentos_pendentes
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
                 AND $3::boolean
                 AND tp.data_pagamento BETWEEN $4::date AND $5::date
               )
             )`,
          [escolaId, ano?.id || null, intervaloValido, ano?.data_inicio || null, ano?.data_fim || null]
        ),
        db.query(
          `SELECT eal.ano_letivo_id AS id, al.ano_nome,
                  COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado = 'aprovado'), 0)::numeric AS receita_aprovada,
                  COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado IN ('pendente_aprovacao', 'flagged')), 0)::numeric AS receita_pendente
           FROM escola_anos_letivos eal
           JOIN anos_letivos al ON al.id = eal.ano_letivo_id
           LEFT JOIN tesouraria_pagamentos tp ON tp.escola_id = eal.escola_id
             AND (
               (
                 tp.matricula_id IS NOT NULL
                 AND EXISTS (
                   SELECT 1
                   FROM matriculas m
                   WHERE m.id = tp.matricula_id
                     AND m.escola_id = eal.escola_id
                     AND m.ano_letivo_id = eal.ano_letivo_id
                 )
               )
               OR (
                 tp.matricula_id IS NULL
                 AND tp.ano_letivo_id IS NULL
                 AND eal.data_inicio IS NOT NULL
                 AND eal.data_fim IS NOT NULL
                 AND tp.data_pagamento BETWEEN eal.data_inicio AND eal.data_fim
               )
               OR tp.ano_letivo_id = eal.ano_letivo_id
             )
           WHERE eal.escola_id = $1
           GROUP BY eal.ano_letivo_id, al.ano_nome, eal.data_inicio
           ORDER BY eal.data_inicio ASC NULLS LAST, al.ano_nome ASC`,
          [escolaId]
        ),
        db.query(
          `SELECT tp.estado, COUNT(*)::int AS quantidade
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
                 AND $3::boolean
                 AND tp.data_pagamento BETWEEN $4::date AND $5::date
               )
             )
           GROUP BY tp.estado
           ORDER BY quantidade DESC, tp.estado ASC`,
          [escolaId, ano?.id || null, intervaloValido, ano?.data_inicio || null, ano?.data_fim || null]
        ),
        db.query(
          `WITH pagamentos_por_matricula AS (
             SELECT m.id AS matricula_id,
                    COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado = 'aprovado'), 0)::numeric AS valor_aprovado,
                    COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado IN ('pendente_aprovacao', 'flagged')), 0)::numeric AS valor_pendente
             FROM matriculas m
             LEFT JOIN tesouraria_pagamentos tp
               ON tp.matricula_id = m.id AND tp.escola_id = m.escola_id
             WHERE m.escola_id = $1
               AND ($2::uuid IS NULL OR m.ano_letivo_id = $2)
             GROUP BY m.id
           )
           SELECT COALESCE(p.nome, 'Ramo não atribuído') AS name,
                  COUNT(DISTINCT m.aluno_id)::int AS alunos,
                  COALESCE(SUM(pm.valor_aprovado), 0)::numeric AS receita_aprovada,
                  COALESCE(SUM(pm.valor_pendente), 0)::numeric AS receita_pendente
           FROM matriculas m
           LEFT JOIN polos_escola p ON p.id = m.polo_id AND p.escola_id = m.escola_id
           LEFT JOIN pagamentos_por_matricula pm ON pm.matricula_id = m.id
           WHERE m.escola_id = $1 AND m.estado = 'ativa'
             AND ($2::uuid IS NULL OR m.ano_letivo_id = $2)
           GROUP BY p.nome
           ORDER BY receita_aprovada DESC, alunos DESC, name`,
          [escolaId, ano?.id || null]
        ),
        db.query(
          `WITH distribuicoes AS (
             SELECT tpa.propina_taxa_id, tpa.valor,
                    tpa.pagamento_id AS talao_id, 'pagamento'::text AS origem
             FROM tesouraria_pagamentos_alocacoes tpa
             JOIN tesouraria_pagamentos tp
               ON tp.id = tpa.pagamento_id
              AND tp.escola_id = tpa.escola_id
             WHERE tpa.escola_id = $1
               AND tp.codigo_talao IS NOT NULL
               AND ($2::uuid IS NULL OR tpa.ano_letivo_id = $2)

             UNION ALL

             SELECT tpa.propina_taxa_id, tpa.valor,
                    tpa.movimento_id AS talao_id, 'movimento_manual'::text AS origem
             FROM tesouraria_pagamentos_alocacoes tpa
             JOIN tesouraria_movimentos tm
               ON tm.id = tpa.movimento_id
              AND tm.escola_id = tpa.escola_id
              AND tm.tipo = 'entrada'
             WHERE tpa.escola_id = $1
               AND ($2::uuid IS NULL OR tpa.ano_letivo_id = $2)
           )
           SELECT pt.id AS propina_taxa_id, pt.nome,
                  SUM(distribuicao.valor)::numeric AS montante,
                  COUNT(DISTINCT (distribuicao.origem, distribuicao.talao_id))::int AS quantidade_taloes
           FROM distribuicoes distribuicao
           JOIN propinas_taxas pt
             ON pt.id = distribuicao.propina_taxa_id
            AND pt.escola_id = $1
           GROUP BY pt.id, pt.nome
           ORDER BY montante DESC, pt.nome ASC`,
          [escolaId, ano?.id || null]
        )
      ]);

    return res.json({
      success: true,
      dados: {
        escola_id: escolaId,
        escola_nome: escolaResult.rows[0]?.nome || '',
        ano_letivo_id: ano?.id || null,
        ano_letivo: ano,
        anos_letivos: anosResult.rows,
        alunos_ativos: Number(alunosResult.rows[0]?.total || 0),
        turmas_ativas: Number(turmasResult.rows[0]?.total || 0),
        professores_ativos: Number(professoresResult.rows[0]?.total || 0),
        receita_aprovada: Number(tesourariaResult.rows[0]?.receita_aprovada || 0),
        receita_pendente: Number(tesourariaResult.rows[0]?.receita_pendente || 0),
        pagamentos_pendentes: Number(tesourariaResult.rows[0]?.pagamentos_pendentes || 0),
        evolucao_financeira: evolucaoFinanceiraResult.rows.map((item) => ({
          ano_letivo_id: item.id,
          ano_nome: item.ano_nome,
          receita_aprovada: Number(item.receita_aprovada || 0),
          receita_pendente: Number(item.receita_pendente || 0)
        })),
        pagamentos_por_estado: pagamentosEstadoResult.rows.map((item) => ({
          estado: item.estado,
          quantidade: Number(item.quantidade || 0)
        })),
        polos: polosResult.rows.map((polo) => ({
          name: polo.name,
          alunos: Number(polo.alunos || 0),
          receita_aprovada: Number(polo.receita_aprovada || 0),
          receita_pendente: Number(polo.receita_pendente || 0)
        })),
        alocacoes_talao_por_item: alocacoesTalaoResult.rows.map((item) => ({
          propina_taxa_id: item.propina_taxa_id,
          nome: item.nome,
          montante: Number(item.montante || 0),
          quantidade_taloes: Number(item.quantidade_taloes || 0)
        }))
      }
    });
  } catch (error) {
    console.error('Erro ao carregar dashboard da Secretaria:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar os indicadores da escola.' });
  }
});

router.get('/notificacoes', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa.' });
    }

    const anosResult = await db.query(
      `SELECT eal.ano_letivo_id AS id, eal.data_inicio::text AS data_inicio,
              eal.data_fim::text AS data_fim, eal.ativo
       FROM escola_anos_letivos eal
       WHERE eal.escola_id = $1
       ORDER BY eal.ativo DESC, eal.data_inicio DESC NULLS LAST`,
      [escolaId]
    );
    const anoId = req.query.ano_letivo_id ||
      anosResult.rows.find((item) => item.ativo)?.id ||
      anosResult.rows[0]?.id ||
      null;
    if (anoId && !UUID_PATTERN.test(anoId)) {
      return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
    }
    const ano = anosResult.rows.find((item) => item.id === anoId) || null;
    if (anoId && !ano) {
      return res.status(404).json({ success: false, message: 'O ano letivo não está associado a esta escola.' });
    }
    const intervaloValido = req.query.todos !== 'true'
      && Boolean(ano?.data_inicio && ano?.data_fim && ano.data_inicio <= ano.data_fim);

    const resultado = await db.query(
      `WITH atividade_real AS (
         SELECT m.id::text AS id, 'matricula'::text AS categoria,
                'Registo de matrícula'::text AS titulo,
                CONCAT(
                  'Matrícula ', m.numero_matricula, ' · ',
                  TRIM(CONCAT(u.nome, ' ', COALESCE(a.apelido, ''))),
                  ' · Estado atual: ', m.estado
                ) AS mensagem,
                COALESCE(m.criado_em, m.data_matricula::timestamptz) AS data_hora,
                NULL::text AS autor
         FROM matriculas m
         JOIN alunos a ON a.id = m.aluno_id
         JOIN utilizadores u ON u.id = a.utilizador_id
         WHERE m.escola_id = $1

         UNION ALL

         SELECT tp.id::text, 'pagamento'::text,
                CASE tp.estado
                  WHEN 'aprovado' THEN 'Pagamento aprovado'
                  WHEN 'flagged' THEN 'Pagamento sinalizado'
                  ELSE 'Pagamento submetido'
                END,
                CONCAT(
                  'Referência ', COALESCE(tp.referencia_banco, 'sem referência'),
                  ' · ', COALESCE(pt.nome, 'Item de pagamento'),
                  ' · ', TO_CHAR(tp.valor, 'FM999G999G990D00'), ' CFA',
                  ' · Estado atual: ', tp.estado
                ),
                COALESCE(tp.atualizado_em, tp.criado_em),
                registador.nome::text
         FROM tesouraria_pagamentos tp
         LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
         LEFT JOIN utilizadores registador ON registador.id = tp.registado_por
         WHERE tp.escola_id = $1

         UNION ALL

         SELECT d.id::text, 'documento'::text,
                'Documento registado'::text,
                CONCAT(
                  COALESCE(d.titulo, d.nome_original),
                  CASE WHEN u.id IS NOT NULL
                    THEN CONCAT(' · Aluno: ', TRIM(CONCAT(u.nome, ' ', COALESCE(a.apelido, ''))))
                    ELSE ''
                  END,
                  ' · Estado atual: ', d.estado
                ),
                COALESCE(d.criado_em, d.atualizado_em),
                carregador.nome::text
         FROM documentos_uploads d
         LEFT JOIN alunos a ON a.id = d.aluno_id
         LEFT JOIN utilizadores u ON u.id = a.utilizador_id
         LEFT JOIN utilizadores carregador ON carregador.id = d.carregado_por
         WHERE d.escola_id = $1

         UNION ALL

         SELECT t.id::text, 'turma'::text,
                'Registo de turma'::text,
                CONCAT(
                  'Turma ', t.nome,
                  CASE WHEN t.classe IS NOT NULL THEN CONCAT(' · ', t.classe) ELSE '' END,
                  ' · ', CASE WHEN t.ativo THEN 'ativa' ELSE 'inativa' END
                ),
                COALESCE(t.atualizado_em, t.criado_em),
                NULL::text
         FROM turmas t
         WHERE t.escola_id = $1

         UNION ALL

         SELECT eal.id::text, 'ano'::text,
                'Ano letivo configurado'::text,
                CONCAT(
                  al.ano_nome, ' · ',
                  TO_CHAR(eal.data_inicio, 'DD/MM/YYYY'), ' a ',
                  TO_CHAR(eal.data_fim, 'DD/MM/YYYY'), ' · ',
                  CASE WHEN eal.ativo THEN 'ativo' ELSE 'inativo' END
                ),
                COALESCE(eal.atualizado_em, eal.criado_em),
                NULL::text
         FROM escola_anos_letivos eal
         JOIN anos_letivos al ON al.id = eal.ano_letivo_id
         WHERE eal.escola_id = $1

         UNION ALL

         SELECT f.id::text, 'documento'::text,
                'Documento partilhado'::text,
                CONCAT(
                  f.titulo, ' · ', COALESCE(f.descricao, ''),
                  ' · Carregado por ', carregador.nome
                ),
                f.criado_em,
                carregador.nome::text
         FROM ficheiros_partilhados f
         JOIN utilizadores carregador ON carregador.id = f.carregado_por
         WHERE f.escola_id = $1
           AND f.estado = 'ativo'
           AND (
             f.visibilidade = 'publico'
             OR f.carregado_por = $5
             OR $6 = ANY(f.destinatarios)
           )
       )
       SELECT atividade_real.id, atividade_real.categoria, atividade_real.titulo,
              atividade_real.mensagem, atividade_real.data_hora, atividade_real.autor,
              COUNT(*) OVER()::int AS total_count
       FROM atividade_real
       WHERE data_hora IS NOT NULL
         AND (
           NOT $2::boolean
           OR data_hora::date BETWEEN $3::date AND $4::date
         )
       ORDER BY data_hora DESC
       LIMIT 100`,
      [
        escolaId,
        intervaloValido,
        ano?.data_inicio || null,
        ano?.data_fim || null,
        req.user?.id || null,
        String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '').toLowerCase()
      ]
    );
    const total = Number(resultado.rows[0]?.total_count || 0);
    const dados = resultado.rows.map(({ total_count, ...notificacao }) => notificacao);

    return res.json({
      success: true,
      total,
      dados
    });
  } catch (error) {
    console.error('Erro ao carregar atividade real da Secretaria:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar notificações da escola.' });
  }
});

router.get('/documentos/alunos', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa.' });
    }

    const resultado = await db.query(
      `SELECT m.id AS matricula_id, m.aluno_id, m.numero_matricula,
              u.nome AS aluno_nome, a.apelido
       FROM matriculas m
       JOIN alunos a ON a.id = m.aluno_id
       JOIN utilizadores u ON u.id = a.utilizador_id
       WHERE m.escola_id = $1 AND m.estado = 'ativa'
       ORDER BY u.nome, a.apelido, m.numero_matricula`,
      [escolaId]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar alunos para documentos:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar os alunos matriculados.' });
  }
});

router.get('/documentos', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa.' });
    }

    const { tipo, busca } = req.query;
    const parametros = [escolaId];
    let filtro = '';
    if (typeof tipo === 'string' && tipo !== 'todos') {
      parametros.push(tipo);
      filtro += ` AND d.tipo_documento = $${parametros.length}`;
    }
    if (typeof busca === 'string' && busca.trim()) {
      parametros.push(`%${busca.trim()}%`);
      filtro += ` AND (d.titulo ILIKE $${parametros.length}
        OR d.nome_original ILIKE $${parametros.length}
        OR d.tipo_documento ILIKE $${parametros.length}
        OR u.nome ILIKE $${parametros.length}
        OR a.apelido ILIKE $${parametros.length}
        OR m.numero_matricula ILIKE $${parametros.length})`;
    }

    const resultado = await db.query(
      `SELECT d.id, d.aluno_id, d.matricula_id, d.titulo, d.destino,
              d.nome_original, d.caminho_ficheiro, d.tipo_documento,
              d.tipo_mime, d.tamanho_bytes, d.descricao, d.estado, d.criado_em,
              u.nome AS aluno_nome, a.apelido AS aluno_apelido,
              m.numero_matricula, carregador.nome AS carregado_por_nome
       FROM documentos_uploads d
       LEFT JOIN alunos a ON a.id = d.aluno_id
       LEFT JOIN utilizadores u ON u.id = a.utilizador_id
       LEFT JOIN matriculas m ON m.id = d.matricula_id AND m.escola_id = d.escola_id
       JOIN utilizadores carregador ON carregador.id = d.carregado_por
       WHERE d.escola_id = $1${filtro}
       ORDER BY d.criado_em DESC
       LIMIT 500`,
      parametros
    );
    return res.json({ success: true, total: resultado.rowCount, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao listar documentos da Secretaria:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar os documentos da escola.' });
  }
});

router.post('/documentos', verificarAutenticacao, receberFicheiroDocumento, async (req, res) => {
  let caminhoDocumento;
  try {
    const escolaId = req.contaAtiva?.escola_id;
    const { matricula_id, titulo, tipo, destino, observacoes } = req.body || {};
    if (!escolaId || !req.user?.id) {
      return res.status(403).json({ success: false, message: 'É necessária uma sessão com escola ativa.' });
    }
    if (!UUID_PATTERN.test(matricula_id || '') ||
        typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180 ||
        !tiposDocumento.has(tipo) ||
        typeof destino !== 'string' || !destino.trim() || destino.trim().length > 180 ||
        (observacoes && (typeof observacoes !== 'string' || observacoes.length > 2000))) {
      return res.status(400).json({ success: false, message: 'Preencha o aluno, tipo, título e destino com valores válidos.' });
    }
    if (!validarFicheiroDocumento(req.file)) {
      return res.status(400).json({ success: false, message: 'Anexe um PDF, DOCX ou uma imagem JPEG, PNG ou WEBP válida.' });
    }

    const matricula = await db.query(
      `SELECT m.id, m.aluno_id
       FROM matriculas m
       WHERE m.id = $1 AND m.escola_id = $2 AND m.estado = 'ativa'`,
      [matricula_id, escolaId]
    );
    if (!matricula.rowCount) {
      return res.status(400).json({ success: false, message: 'A matrícula selecionada não está ativa nesta escola.' });
    }

    const extensao = path.extname(req.file.originalname).toLowerCase();
    const nomeArmazenado = `${crypto.randomUUID()}${extensao}`;
    await fs.promises.mkdir(documentosDir, { recursive: true });
    caminhoDocumento = path.join(documentosDir, nomeArmazenado);
    await fs.promises.writeFile(caminhoDocumento, req.file.buffer, { flag: 'wx' });

    const nomeOriginal = path.basename(req.file.originalname).replace(/[\r\n]/g, '').slice(0, 255);
    const resultado = await db.query(
      `INSERT INTO documentos_uploads (
         escola_id, aluno_id, funcionario_id, carregado_por, nome_original,
         nome_armazenado, caminho_ficheiro, tipo_documento, tipo_mime,
         tamanho_bytes, descricao, estado, titulo, destino, matricula_id,
         criado_em, atualizado_em
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, 'ativo', $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, titulo, destino, nome_original, tipo_documento, tamanho_bytes, estado, criado_em`,
      [
        escolaId, matricula.rows[0].aluno_id, req.user.id, nomeOriginal,
        nomeArmazenado, `private_uploads/documentos/${nomeArmazenado}`,
        tipo, mimePorExtensao[extensao], req.file.size, observacoes?.trim() || null,
        titulo.trim(), destino.trim(), matricula.rows[0].id
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Documento carregado e registado com sucesso.',
      dados: resultado.rows[0]
    });
  } catch (error) {
    if (caminhoDocumento) {
      await fs.promises.unlink(caminhoDocumento).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') console.error('Erro ao remover ficheiro após falha do registo:', cleanupError);
      });
    }
    console.error('Erro ao guardar documento da Secretaria:', error);
    return res.status(500).json({ success: false, message: 'Erro ao guardar o documento.' });
  }
});

router.get('/documentos/:id/ficheiro', verificarAutenticacao, async (req, res) => {
  try {
    const escolaId = req.contaAtiva?.escola_id;
    const { id } = req.params;
    if (!escolaId || !UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: 'Identificador inválido.' });
    }

    const resultado = await db.query(
      `SELECT nome_armazenado, caminho_ficheiro, nome_original, tipo_mime
       FROM documentos_uploads
       WHERE id = $1 AND escola_id = $2`,
      [id, escolaId]
    );
    if (!resultado.rowCount) {
      return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
    }

    const documento = resultado.rows[0];
    const nomeSeguro = path.basename(documento.nome_armazenado);
    const arquivoPrivado = path.resolve(documentosDir, nomeSeguro);
    const arquivoLegado = path.resolve(__dirname, '../public/uploads', path.basename(documento.caminho_ficheiro));
    let caminho = arquivoPrivado;
    try {
      await fs.promises.access(arquivoPrivado, fs.constants.R_OK);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      caminho = arquivoLegado;
      await fs.promises.access(arquivoLegado, fs.constants.R_OK);
    }

    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(documento.nome_original)}`,
      'X-Content-Type-Options': 'nosniff'
    });
    return res.type(documento.tipo_mime || 'application/octet-stream').sendFile(caminho);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: 'O ficheiro deste documento não está disponível.' });
    }
    console.error('Erro ao abrir documento da Secretaria:', error);
    return res.status(500).json({ success: false, message: 'Erro ao abrir o documento.' });
  }
});

// ============================================================
// 1. LISTAR HORÁRIOS DE UMA ESCOLA (ou filtrado por turma UUID)
// Rota: GET /api/v1/secretaria/escolas/:escolaId/horarios
// ============================================================
router.get('/escolas/:escolaId/horarios', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { turma_id, ano_letivo_id, polo_id } = req.query;
    if (!verificarEscolaAtiva(req, res, escolaId)) return;
    if ((turma_id && !UUID_PATTERN.test(turma_id))
      || (ano_letivo_id && !UUID_PATTERN.test(ano_letivo_id))
      || (polo_id && !UUID_PATTERN.test(polo_id))) {
      return res.status(400).json({ success: false, message: "Turma, ano letivo ou ramo inválido." });
    }

    let query = `
      SELECT 
        h.id,
        h.escola_id,
        h.turma_id,
        t.nome AS nome_turma,
        t.classe,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fim,
        h.disciplina,
        h.professor,
        h.sala
      FROM turmas_horarios h
      JOIN turmas t ON t.id = h.turma_id AND t.escola_id = h.escola_id
      WHERE h.escola_id = $1 AND t.ativo = true
    `;
    const params = [escolaId];

    if (turma_id) {
      params.push(turma_id);
      query += ` AND h.turma_id = $${params.length}`;
    }
    if (ano_letivo_id) {
      params.push(ano_letivo_id);
      query += ` AND t.ano_letivo_id = $${params.length}`;
    }
    if (polo_id) {
      params.push(polo_id);
      query += ` AND t.polo_id = $${params.length}`;
    }

    query += ` ORDER BY h.turma_id ASC, h.dia_semana ASC, h.hora_inicio ASC;`;

    const resultado = await db.query(query, params);

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar horários (UUID):", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar horários." });
  }
});


// ============================================================
// 2. CRIAR NOVO BLOCO DE HORÁRIO (TIMETABLE) COM UUID
// Rota: POST /api/v1/secretaria/escolas/:escolaId/horarios
// ============================================================
router.post('/escolas/:escolaId/horarios', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { turma_id, dia_semana, hora_inicio, hora_fim, disciplina, professor, sala } = req.body;
    if (!verificarEscolaAtiva(req, res, escolaId)) return;

    if (!turma_id || !dia_semana || !hora_inicio || !hora_fim || !disciplina) {
      return res.status(400).json({ success: false, message: "Turma, dia da semana, horários e disciplina são obrigatórios." });
    }

    const query = `
      INSERT INTO turmas_horarios (escola_id, turma_id, dia_semana, hora_inicio, hora_fim, disciplina, professor, sala)
      SELECT $1, $2, $3, $4, $5, $6, $7, $8
      WHERE EXISTS (SELECT 1 FROM turmas WHERE id = $2 AND escola_id = $1)
      RETURNING *;
    `;
    const values = [escolaId, turma_id, dia_semana, hora_inicio, hora_fim, disciplina, professor || null, sala || null];

    const resultado = await db.query(query, values);
    if (resultado.rowCount === 0) {
      return res.status(400).json({ success: false, message: 'A turma não pertence a esta escola.' });
    }

    return res.status(201).json({
      success: true,
      message: "Horário criado com sucesso!",
      dados: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao criar horário (UUID):", error);
    return res.status(500).json({ success: false, message: "Erro ao criar horário." });
  }
});


// ============================================================
// 3. EDITAR BLOCO DE HORÁRIO (UUID)
// Rota: PUT /api/v1/secretaria/horarios/:id
// ============================================================
router.put('/horarios/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const { dia_semana, hora_inicio, hora_fim, disciplina, professor, sala } = req.body;
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa para editar horários.' });
    }
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: 'Identificador do horário inválido.' });
    }

    const query = `
      UPDATE turmas_horarios 
      SET dia_semana = COALESCE($1, dia_semana),
          hora_inicio = COALESCE($2, hora_inicio),
          hora_fim = COALESCE($3, hora_fim),
          disciplina = COALESCE($4, disciplina),
          professor = COALESCE($5, professor),
          sala = COALESCE($6, sala)
      WHERE id = $7 AND escola_id = $8
      RETURNING *;
    `;
    const values = [dia_semana, hora_inicio, hora_fim, disciplina, professor, sala, id, escolaId];

    const resultado = await db.query(query, values);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Horário não encontrado." });
    }

    return res.json({
      success: true,
      message: "Horário atualizado com sucesso!",
      dados: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao atualizar horário (UUID):", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar horário." });
  }
});


// ============================================================
// 4. ELIMINAR BLOCO DE HORÁRIO (UUID)
// Rota: DELETE /api/v1/secretaria/horarios/:id
// ============================================================
router.delete('/horarios/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const escolaId = req.contaAtiva?.escola_id;
    if (!escolaId) {
      return res.status(403).json({ success: false, message: 'É necessária uma escola ativa para eliminar horários.' });
    }
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: 'Identificador do horário inválido.' });
    }

    const resultado = await db.query(
      `DELETE FROM turmas_horarios WHERE id = $1 AND escola_id = $2 RETURNING id;`,
      [id, escolaId]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Horário não encontrado." });
    }

    return res.json({ success: true, message: "Horário eliminado com sucesso." });

  } catch (error) {
    console.error("Erro ao eliminar horário (UUID):", error);
    return res.status(500).json({ success: false, message: "Erro ao eliminar horário." });
  }
});

module.exports = router;