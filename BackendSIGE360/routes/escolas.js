const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const db = require('../config/db');
const { verificarAutenticacao, normalizarPapel } = require('../middlewares/middleware');
const { hashPassword, verifyPassword } = require('../services/authService');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { comprimirFotoPassaporteParaBase64, comprimirImagemParaLimite } = require('../services/imageService');
const uploadFotoFuncionario = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('A fotografia deve estar em formato JPEG, PNG ou WebP.'));
    }
    return callback(null, true);
  }
});

function receberFotoFuncionario(req, res, next) {
  uploadFotoFuncionario.single('foto')(req, res, (error) => {
    if (!error) return next();
    const limite = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(limite ? 413 : 400).json({
      success: false,
      message: limite
        ? 'A fotografia original deve ter no máximo 10 MB.'
        : error.message || 'Não foi possível receber a fotografia.'
    });
  });
}

const CLASSES_BY_BRANCH = {
  jardim: ["1ª Etapa (Maternal)", "2ª Etapa (Jardim)", "3ª Etapa (Pré-Escolar)"],
  basico1: ["1ª Classe", "2ª Classe", "3ª Classe", "4ª Classe"],
  basico2: ["5ª Classe", "6ª Classe"],
  basico3: ["7ª Classe", "8ª Classe", "9ª Classe"],
  liceu: ["10ª Classe", "11ª Classe", "12ª Classe"],
  tecnico: ["Ano I (Módulo Inicial)", "Ano II (Módulo Intermédio)", "Ano III (Módulo Avançado)"],
  superior: ["1º Ano (Licenciatura)", "2º Ano", "3º Ano", "4º Ano"]
};
const ALL_CLASSES = Object.values(CLASSES_BY_BRANCH).flat();
const POLO_BRANCH_CODES = ['SEDE', 'RAM1', 'RAM2', 'RAM3', 'JARD', 'RAML', 'FORM', 'SUPR'];
const BRANCHES_BY_LEVEL = [
  { branch: 'jardim', pattern: /jardim|infantil/ },
  { branch: 'basico1', pattern: /1(?:º|o)?\s*ciclo/ },
  { branch: 'basico2', pattern: /2(?:º|o)?\s*ciclo/ },
  { branch: 'basico3', pattern: /3(?:º|o)?\s*ciclo/ },
  { branch: 'liceu', pattern: /secundario|liceu/ },
  { branch: 'tecnico', pattern: /tecnico|profissional/ },
  { branch: 'superior', pattern: /superior|universidade/ }
];

function podeAcederEscola(req, escolaId) {
  return req.user?.isOwner === true || req.contaAtiva?.escola_id === escolaId;
}

function podeGerirConfiguracoesEscola(req, escolaId) {
  if (req.user?.isOwner === true) return true;
  if (req.contaAtiva?.escola_id !== escolaId) return false;
  return ['direcao', 'diretor', 'diretora', 'admin', 'administrador']
    .includes(normalizarPapel(req.contaAtiva?.papel_norm || req.contaAtiva?.papel));
}

function dataValida(data) {
  return typeof data === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(data) &&
    !Number.isNaN(Date.parse(data)) &&
    new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10) === data;
}

async function sincronizarPeriodosLetivos(client, escolaId, sistemaPeriodo) {
  const numeroPeriodos = sistemaPeriodo === 'semestres' ? 2 : 3;
  const resultado = await client.query(
    `WITH periodos AS (
       SELECT eal.ano_letivo_id, eal.data_inicio, eal.data_fim,
              gs.numero::smallint AS numero
       FROM escola_anos_letivos eal
       CROSS JOIN generate_series(1, $2::integer) AS gs(numero)
       WHERE eal.escola_id = $1 AND eal.ativo = true
     ), limites AS (
       SELECT ano_letivo_id, numero,
              CASE WHEN data_inicio IS NOT NULL AND data_fim IS NOT NULL
                     AND data_fim >= data_inicio
                     AND (data_fim - data_inicio + 1) >= $2
                THEN data_inicio + FLOOR(((data_fim - data_inicio + 1)::numeric * (numero - 1) / $2))::integer
                ELSE NULL END AS data_inicio,
              CASE WHEN data_inicio IS NOT NULL AND data_fim IS NOT NULL
                     AND data_fim >= data_inicio
                     AND (data_fim - data_inicio + 1) >= $2
                THEN data_inicio + FLOOR(((data_fim - data_inicio + 1)::numeric * numero / $2))::integer - 1
                ELSE NULL END AS data_fim
       FROM periodos
     )
     INSERT INTO trimestres (ano_letivo_id, numero, nome, data_inicio, data_fim, ativo)
     SELECT ano_letivo_id, numero,
            CASE WHEN $3 = 'semestres' THEN numero::text || 'º Semestre'
                 ELSE numero::text || 'º Trimestre' END,
            data_inicio, data_fim, true
     FROM limites
     ON CONFLICT (ano_letivo_id, numero) DO UPDATE SET
       nome = EXCLUDED.nome,
       data_inicio = COALESCE(EXCLUDED.data_inicio, trimestres.data_inicio),
       data_fim = COALESCE(EXCLUDED.data_fim, trimestres.data_fim),
       ativo = true
     RETURNING id`,
    [escolaId, numeroPeriodos, sistemaPeriodo]
  );

  return resultado.rowCount;
}

function classesDoPolo(polo, niveisEscola = null) {
  const codigo = String(polo.codigo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  const classesPorCodigo = {
    SEDE: ALL_CLASSES,
    RAM1: CLASSES_BY_BRANCH.basico1,
    RAM2: CLASSES_BY_BRANCH.basico2,
    RAM3: CLASSES_BY_BRANCH.basico3,
    JARD: CLASSES_BY_BRANCH.jardim,
    RAML: CLASSES_BY_BRANCH.liceu,
    FORM: CLASSES_BY_BRANCH.tecnico,
    SUPR: CLASSES_BY_BRANCH.superior
  };
  let classes = Array.isArray(classesPorCodigo[codigo]) ? classesPorCodigo[codigo] : null;

  if (!classes) {
    const identificacao = `${polo.codigo || ''} ${polo.nome || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (/jardim|infantil|pre-escolar|maternal/.test(identificacao)) classes = CLASSES_BY_BRANCH.jardim;
    else if (/basico.*3|3.*ciclo/.test(identificacao)) classes = CLASSES_BY_BRANCH.basico3;
    else if (/basico.*2|2.*ciclo|segd/.test(identificacao)) classes = CLASSES_BY_BRANCH.basico2;
    else if (/basico.*1|1.*ciclo|primario/.test(identificacao)) classes = CLASSES_BY_BRANCH.basico1;
    else if (/liceu|secundario/.test(identificacao)) classes = CLASSES_BY_BRANCH.liceu;
    else if (/tecnico|profissional/.test(identificacao)) classes = CLASSES_BY_BRANCH.tecnico;
    else if (/universidade|superior/.test(identificacao)) classes = CLASSES_BY_BRANCH.superior;
    else if (/\bsede\b|extensao|anexo/.test(identificacao)) classes = ALL_CLASSES;
    else classes = [];
  }

  if (!Array.isArray(niveisEscola)) return classes;

  const nomesNormalizados = niveisEscola
    .map((nome) => String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  const ramosPermitidos = new Set(
    BRANCHES_BY_LEVEL
      .filter(({ pattern }) => nomesNormalizados.some((nome) => pattern.test(nome)))
      .map(({ branch }) => branch)
  );
  const classesPermitidas = new Set([...ramosPermitidos].flatMap((ramo) => CLASSES_BY_BRANCH[ramo]));
  return classes.filter((classe) => classesPermitidas.has(classe));
}

async function obterNiveisEnsinoEscola(escolaId) {
  const resultado = await db.query(
    `SELECT ne.nome
     FROM escolas_niveis en
     JOIN niveis_ensino ne ON ne.id = en.nivel_id
     WHERE en.escola_id = $1`,
    [escolaId]
  );
  return resultado.rows.map((nivel) => nivel.nome);
}

function codigoPoloPermitido(codigo, niveisEscola) {
  const codigoNormalizado = typeof codigo === 'string' ? codigo.trim().toUpperCase() : '';
  return POLO_BRANCH_CODES.includes(codigoNormalizado)
    && classesDoPolo({ codigo: codigoNormalizado }, niveisEscola).length > 0;
}

// Função para gerar senha com base nos últimos 7 dígitos do telefone
function gerarSenhaPorTelefone(telefone) {
  if (!telefone) return '1234567';
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length >= 7) {
    return digitos.slice(-7);
  }
  return digitos.length > 0 ? digitos.padEnd(7, '0') : '1234567';
}

// ============================================================
// 1. ROTAS ESPECÍFICAS DE CADA ESCOLA (`escola_anos_letivos`)
// ============================================================

// GET: Listar os anos letivos configurados de uma escola específica
router.get('/escolas/:escolaId/anos-letivos', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeAcederEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }

    const query = `
      SELECT 
        eal.id,
        eal.escola_id,
        eal.ano_letivo_id,
        al.ano_nome,
        eal.data_inicio,
        eal.data_fim,
        eal.ativo,
        prazo.data_inicio AS matricula_data_inicio,
        prazo.data_fim AS matricula_data_fim,
        (eal.ativo = true AND prazo.ativo = true
          AND prazo.data_inicio IS NOT NULL AND prazo.data_fim IS NOT NULL
          AND CURRENT_DATE BETWEEN prazo.data_inicio AND prazo.data_fim) AS matricula_aberta,
        eal.criado_em,
        eal.atualizado_em
      FROM escola_anos_letivos eal
      JOIN anos_letivos al ON al.id = eal.ano_letivo_id
      LEFT JOIN LATERAL (
        SELECT pm.data_inicio, pm.data_fim, pm.ativo
        FROM prazos_matricula pm
        WHERE pm.escola_id = eal.escola_id
          AND pm.anos_letivo_id = eal.ano_letivo_id
        ORDER BY CASE WHEN pm.ativo = true
                           AND CURRENT_DATE BETWEEN pm.data_inicio AND pm.data_fim
                      THEN 1 ELSE 0 END DESC,
                 pm.ativo DESC, pm.data_inicio DESC, pm.criado_em DESC
        LIMIT 1
      ) prazo ON true
      WHERE eal.escola_id = $1
      ORDER BY eal.data_inicio DESC;
    `;

    const resultado = await db.query(query, [escolaId]);

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar anos letivos da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar anos letivos da escola." });
  }
});

// POST: Adicionar/Associar ano letivo a uma escola (com datas de início e fim)
router.post('/escolas/:escolaId/anos-letivos', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { escolaId } = req.params;
    const { ano_letivo_id, data_inicio, data_fim, ativo } = req.body || {};

    if (!UUID_PATTERN.test(escolaId) || !UUID_PATTERN.test(ano_letivo_id || '')) {
      return res.status(400).json({
        success: false,
        message: "A escola ou o ano letivo selecionado é inválido."
      });
    }
    if (!podeGerirConfiguracoesEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar as configurações desta escola." });
    }
    const datasValidas = [data_inicio, data_fim].every(dataValida);
    if (!datasValidas || data_inicio > data_fim || (ativo !== undefined && typeof ativo !== 'boolean')) {
      return res.status(400).json({ success: false, message: "Informe um intervalo de datas válido e um estado ativo booleano." });
    }

    client = await db.connect();
    await client.query("BEGIN");

    // Se este ano letivo for definido como ativo para a escola, desativar os outros da mesma escola
    if (ativo === true) {
      await client.query(`UPDATE escola_anos_letivos SET ativo = false WHERE escola_id = $1`, [escolaId]);
    }

    const novoRegisto = await client.query(
      `INSERT INTO escola_anos_letivos (escola_id, ano_letivo_id, data_inicio, data_fim, ativo)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [escolaId, ano_letivo_id, data_inicio, data_fim, ativo ?? false]
    );

    let periodosSincronizados = 0;
    if (ativo === true) {
      const parametros = await client.query(
        `SELECT sistema_periodo FROM parametros_avaliacao WHERE escola_id = $1 LIMIT 1`,
        [escolaId]
      );
      periodosSincronizados = await sincronizarPeriodosLetivos(
        client,
        escolaId,
        parametros.rows[0]?.sistema_periodo || 'trimestres'
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: `Ano letivo configurado com sucesso. ${periodosSincronizados} períodos sincronizados.`,
      data: novoRegisto.rows[0]
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => { });
    console.error("Erro ao configurar ano letivo da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao registar ano letivo na escola." });
  } finally {
    client?.release();
  }
});

// PUT: Editar ano letivo da escola (alterar datas ou se está ativo)
router.put('/escolas/anos-letivos/:id', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    const { ano_letivo_id, data_inicio, data_fim, ativo } = req.body || {};
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: "Identificador do ano letivo inválido." });
    }
    if (ano_letivo_id !== undefined && !UUID_PATTERN.test(ano_letivo_id)) {
      return res.status(400).json({ success: false, message: "Identificador do ano letivo global inválido." });
    }
    if ((data_inicio !== undefined && data_inicio !== null && !dataValida(data_inicio)) ||
      (data_fim !== undefined && data_fim !== null && !dataValida(data_fim)) ||
      (ativo !== undefined && typeof ativo !== 'boolean')) {
      return res.status(400).json({ success: false, message: "Informe datas válidas e um estado ativo booleano." });
    }

    client = await db.connect();
    await client.query("BEGIN");

    // Obter a escola_id associada a este registo para gerir o estado 'ativo' único por escola
    const regRes = await client.query(
      `SELECT escola_id, data_inicio, data_fim FROM escola_anos_letivos WHERE id = $1`,
      [id]
    );
    if (regRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Configuração de ano letivo não encontrada." });
    }
    const escolaId = regRes.rows[0].escola_id;
    if (!podeGerirConfiguracoesEscola(req, escolaId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar as configurações desta escola." });
    }
    const formatarData = (data) => data instanceof Date ? data.toISOString().slice(0, 10) : String(data).slice(0, 10);
    const dataInicioEfetiva = data_inicio ?? formatarData(regRes.rows[0].data_inicio);
    const dataFimEfetiva = data_fim ?? formatarData(regRes.rows[0].data_fim);
    if (!dataValida(dataInicioEfetiva) || !dataValida(dataFimEfetiva) || dataInicioEfetiva > dataFimEfetiva) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "A data de início não pode ser posterior à data de fim." });
    }

    if (ativo === true) {
      await client.query(`UPDATE escola_anos_letivos SET ativo = false WHERE escola_id = $1`, [escolaId]);
    }

    const atualizado = await client.query(
      `UPDATE escola_anos_letivos SET 
         data_inicio = COALESCE($1, data_inicio),
         data_fim = COALESCE($2, data_fim),
         ativo = COALESCE($3, ativo),
         ano_letivo_id = COALESCE($4, ano_letivo_id),
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [data_inicio || null, data_fim || null, ativo !== undefined ? ativo : null, ano_letivo_id || null, id]
    );

    let periodosSincronizados = 0;
    if (atualizado.rows[0]?.ativo) {
      const parametros = await client.query(
        `SELECT sistema_periodo FROM parametros_avaliacao WHERE escola_id = $1 LIMIT 1`,
        [escolaId]
      );
      periodosSincronizados = await sincronizarPeriodosLetivos(
        client,
        escolaId,
        parametros.rows[0]?.sistema_periodo || 'trimestres'
      );
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: `Ano letivo atualizado. ${periodosSincronizados} períodos sincronizados.`,
      data: atualizado.rows[0]
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => { });
    console.error("Erro ao atualizar ano letivo da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar o ano letivo da escola." });
  } finally {
    client?.release();
  }
});

// ============================================================
// ROTA: CRIAR NOVA DISCIPLINA
// ============================================================
router.post('/disciplinas', verificarAutenticacao, async (req, res) => {
  try {
    const { nome, codigo, descricao, ativa } = req.body || {};

    if (!nome?.trim() || !codigo?.trim()) {
      return res.status(400).json({
        success: false,
        message: "O nome e o código da disciplina são obrigatórios."
      });
    }

    const query = `
      INSERT INTO disciplinas (nome, codigo, descricao, ativa)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const resultado = await db.query(query, [
      nome.trim(),
      codigo.trim().toUpperCase(),
      descricao?.trim() || null,
      ativa !== undefined ? ativa : true
    ]);

    return res.status(201).json({
      success: true,
      message: "Disciplina criada com sucesso.",
      data: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao criar disciplina:", error);
    if (error.code === '23505') { // Erro de unicidade do código
      return res.status(400).json({ success: false, message: "Já existe uma disciplina registada com este código." });
    }
    return res.status(500).json({ success: false, message: "Erro ao criar a disciplina no banco de dados." });
  }
});

// ============================================================
// ROTA: CRIAR NOVO POLO DA ESCOLA
// ============================================================
router.post('/escolas/:escolaId/polos', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { nome, codigo, endereco, local, telefone, ativo } = req.body || {};

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeGerirConfiguracoesEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar as configurações desta escola." });
    }
    if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 150 ||
      typeof codigo !== 'string' || !codigo.trim() || codigo.trim().length > 50) {
      return res.status(400).json({
        success: false,
        message: "O nome e o código do polo são obrigatórios e devem respeitar os limites de tamanho."
      });
    }
    const niveisEscola = await obterNiveisEnsinoEscola(escolaId);
    if (!codigoPoloPermitido(codigo, niveisEscola)) {
      return res.status(400).json({
        success: false,
        message: "O ramo selecionado não está incluído nos níveis de ensino configurados pelo Owner."
      });
    }
    if (endereco !== undefined && (typeof endereco !== 'string' || endereco.length > 255) ||
      local !== undefined && (typeof local !== 'string' || local.length > 100) ||
      telefone !== undefined && (typeof telefone !== 'string' || telefone.length > 50) ||
      ativo !== undefined && typeof ativo !== 'boolean') {
      return res.status(400).json({ success: false, message: "Os dados do polo são inválidos." });
    }

    const query = `
      INSERT INTO polos_escola (escola_id, nome, codigo, endereco, local, telefone, ativo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const resultado = await db.query(query, [
      escolaId,
      nome.trim(),
      codigo.trim().toUpperCase(),
      endereco?.trim() || null,
      local?.trim() || null,
      telefone?.trim() || null,
      ativo !== undefined ? ativo : true
    ]);

    return res.status(201).json({
      success: true,
      message: "Polo escolar criado com sucesso.",
      data: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao criar polo da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao registar o polo escolar." });
  }
});

router.put('/polos/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, codigo, endereco, local, telefone, ativo } = req.body || {};
    if (!req.contaAtiva?.escola_id) {
      return res.status(403).json({ success: false, message: "Escola ativa não identificada." });
    }
    if (!podeGerirConfiguracoesEscola(req, req.contaAtiva.escola_id)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar as configurações desta escola." });
    }
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: "Identificador do polo inválido." });
    }
    if (nome !== undefined && (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 150)) {
      return res.status(400).json({ success: false, message: "O nome do polo deve ter entre 1 e 150 caracteres." });
    }
    if (codigo !== undefined && (typeof codigo !== 'string' || codigo.trim().length > 50)) {
      return res.status(400).json({ success: false, message: "O código do polo não pode ultrapassar 50 caracteres." });
    }
    if (endereco !== undefined && (typeof endereco !== 'string' || endereco.length > 255) ||
      local !== undefined && (typeof local !== 'string' || local.length > 100) ||
      telefone !== undefined && (typeof telefone !== 'string' || telefone.length > 50) ||
      ativo !== undefined && typeof ativo !== 'boolean') {
      return res.status(400).json({ success: false, message: "Os dados do polo são inválidos." });
    }
    const escolaId = req.contaAtiva.escola_id;
    const poloAtual = await db.query(
      'SELECT codigo FROM polos_escola WHERE id = $1 AND escola_id = $2',
      [id, escolaId]
    );
    if (!poloAtual.rowCount) {
      return res.status(404).json({ success: false, message: "Polo não encontrado nesta escola." });
    }
    const codigoFinal = codigo === undefined ? poloAtual.rows[0].codigo : codigo;
    const niveisEscola = await obterNiveisEnsinoEscola(escolaId);
    if (!codigoPoloPermitido(codigoFinal, niveisEscola)) {
      return res.status(400).json({
        success: false,
        message: "O ramo selecionado não está incluído nos níveis de ensino configurados pelo Owner."
      });
    }
    const resultado = await db.query(
      `UPDATE polos_escola SET
         nome = COALESCE($1, nome),
         codigo = COALESCE($2, codigo),
         endereco = $3,
         local = $4,
         telefone = $5,
         ativo = COALESCE($6, ativo),
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $7 AND escola_id = $8
       RETURNING id, escola_id, nome, codigo, endereco, local, telefone, ativo`,
      [
        nome === undefined ? null : nome.trim(),
        codigo === undefined ? null : codigo.trim().toUpperCase(),
        endereco === undefined ? null : endereco.trim() || null,
        local === undefined ? null : local.trim() || null,
        telefone === undefined ? null : telefone.trim() || null,
        ativo === undefined ? null : ativo,
        id,
        escolaId
      ]
    );
    if (!resultado.rowCount) {
      return res.status(404).json({ success: false, message: "Polo não encontrado nesta escola." });
    }
    return res.json({ success: true, message: "Polo atualizado com sucesso.", data: resultado.rows[0] });
  } catch (error) {
    console.error("Erro ao atualizar polo da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar o polo escolar." });
  }
});

// ============================================================
// ROTA: LER INFORMAÇÕES DE UM POLO ESCOLAR ESPECÍFICO
// ============================================================
router.get('/polos/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        p.*,
        e.nome AS escola_nome,
        e.sigla AS escola_sigla
      FROM polos_escola p
      JOIN escolas e ON e.id = p.escola_id
      WHERE p.id = $1
      LIMIT 1;
    `;

    const resultado = await db.query(query, [id]);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Polo escolar não encontrado." });
    }

    return res.json({
      success: true,
      data: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao buscar polo:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar informações do polo." });
  }
});

// ============================================================
// ROTA: LISTAR TODAS AS DISCIPLINAS DO CATÁLOGO
// ============================================================
router.get('/disciplinas', verificarAutenticacao, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        nome,
        codigo,
        descricao,
        ativa,
        criado_em,
        atualizado_em
      FROM disciplinas
      WHERE ativa IS TRUE
      ORDER BY nome ASC;
    `;

    const resultado = await db.query(query);

    return res.json({
      success: true,
      total: resultado.rowCount,
      data: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar disciplinas:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar a lista de disciplinas." });
  }
});


// 2. FUNCIONARIOS ---------------------------------------------------------------------------------
// ============================================================
// 1. ROTA: CRIAR FUNCIONÁRIO (Com Compressão Automática de Foto)
// ============================================================
router.post('/funcionarios/foto', verificarAutenticacao, receberFotoFuncionario, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Selecione uma fotografia JPEG, PNG ou WebP.' });
  }

  try {
    const imagem = sharp(req.file.buffer, { limitInputPixels: 20_000_000 });
    const metadata = await imagem.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return res.status(400).json({ success: false, message: 'O ficheiro enviado não é uma fotografia válida.' });
    }

    const foto_url = await comprimirImagemParaLimite(req.file.buffer);
    const tamanho_bytes = Buffer.byteLength(foto_url.split(',')[1], 'base64');
    return res.json({ success: true, data: { foto_url, tamanho_bytes } });
  } catch (error) {
    console.error('[ESCOLAS] Erro ao comprimir fotografia de funcionário:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Não foi possível processar a fotografia.'
    });
  }
});

router.post('/funcionarios', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    client = await db.connect();
    const {
      escola_id, sigla_escola, papel, polo_id, nome, email, telefone, foto_url, genero,
      morada, bairro, regiao, bi_ou_passaporte, nif_pessoal, data_nascimento, data_admissao,
      data_validade_bi, entidade_emissao_bi, nacionalidade, estado_civil, numero_filhos,
      iban, nivel_estudo, area_estudo, cargo, observacoes,
      escola_estudio_prof, anos_experiencia_prof, campo_estudo_prof, nota_final_prof
    } = req.body || {};

    if (!escola_id || !papel || !nome?.trim() || !telefone?.trim()) {
      return res.status(400).json({ success: false, message: "Campos obrigatórios em falta (Escola, Papel, Nome e Telefone)." });
    }
    if (!UUID_PATTERN.test(escola_id)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeGerirConfiguracoesEscola(req, escola_id)) {
      return res.status(403).json({ success: false, message: "Não tem autorização para criar funcionários nesta escola." });
    }

    const papeisPermitidos = ['secretaria', 'tesouraria', 'professor'];
    const papelLower = papel.toLowerCase();
    if (!papeisPermitidos.includes(papelLower)) {
      return res.status(400).json({ success: false, message: "Cargo / Papel institucional inválido." });
    }

    const escolaRes = await client.query('SELECT sigla FROM escolas WHERE id = $1', [escola_id]);
    if (escolaRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Escola não encontrada." });
    }
    const siglaLogin = String(escolaRes.rows[0].sigla || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
    if (siglaLogin.length !== 2) {
      return res.status(400).json({ success: false, message: "A sigla da escola precisa de pelo menos duas letras para gerar o Login ID." });
    }

    // Comprimir a foto enviada para ~15KB antes de abrir a transação
    const fotoProcessada = typeof foto_url === 'string' && foto_url.startsWith('data:image')
      ? await comprimirImagemParaLimite(foto_url)
      : await comprimirFotoPassaporteParaBase64(foto_url);

    await client.query("BEGIN");

    let atribuicaoPolo = 0;
    if (polo_id) {
      const poloCheck = await client.query(
        `SELECT id, codigo FROM polos_escola WHERE id = $1 AND escola_id = $2 AND ativo = true`,
        [polo_id, escola_id]
      );
      if (poloCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "O polo selecionado é inválido ou não pertence a esta escola." });
      }
      const codigoPolo = String(poloCheck.rows[0].codigo || '').trim().toUpperCase();
      atribuicaoPolo = ({
        JARD: 1,
        RAM1: 2,
        RAM2: 3,
        RAM3: 4,
        RAML: 5,
        FORM: 6
      })[codigoPolo] ?? (codigoPolo === 'SEDE' ? 0 : 7);
    }

    const prefixoLogin = papelLower === 'secretaria'
      ? `${atribuicaoPolo}A1${siglaLogin}`
      : papelLower === 'tesouraria'
        ? `${atribuicaoPolo}A2${siglaLogin}`
        : `P${atribuicaoPolo}${siglaLogin}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [prefixoLogin, papelLower]);
    const serialPattern = `^${prefixoLogin}[0-9]+$`;
    const serialRes = await client.query(
      `WITH total_escola AS (
         SELECT COUNT(DISTINCT u.id)::bigint AS total
         FROM funcionarios f
         JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = $2
         JOIN utilizadores u ON u.id = f.utilizador_id
         WHERE f.escola_id = $1
       ), ultimo_global AS (
         SELECT COALESCE(MAX(substring(u.login_id FROM '([0-9]+)$')::bigint), 0)::bigint AS serial
         FROM utilizadores u
         WHERE u.login_id ~ $3
       )
       SELECT total_escola.total, ultimo_global.serial AS ultimo_serial
       FROM total_escola CROSS JOIN ultimo_global`,
      [escola_id, papelLower, serialPattern]
    );
    const seqId = String(Math.max(
      Number(serialRes.rows[0].total) || 0,
      Number(serialRes.rows[0].ultimo_serial) || 0
    ) + 1).padStart(3, '0');
    const loginId = `${prefixoLogin}${seqId}`;

    const passwordTemporaria = gerarSenhaPorTelefone(telefone);
    const passwordHash = await hashPassword(passwordTemporaria);
    const emailUtilizador = email?.trim() || `${loginId.toLowerCase()}@futurese.gw`;

    const userRes = await client.query(
      `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta) VALUES ($1, $2, $3, $4, $5, true, 'normal') RETURNING id`,
      [nome.trim(), emailUtilizador, telefone.trim(), loginId, passwordHash]
    );
    const userId = userRes.rows[0].id;

    const assocRes = await client.query(
      `INSERT INTO associacoes_escola (escola_id, utilizador_id, status) VALUES ($1, $2, 'ativo') RETURNING id`,
      [escola_id, userId]
    );
    const associacaoId = assocRes.rows[0].id;

    await client.query(`INSERT INTO papeis_utilizador (associacao_id, papel) VALUES ($1, $2)`, [associacaoId, papelLower]);

    await client.query(
      `INSERT INTO funcionarios ( 
                escola_id, utilizador_id, polo_id, foto_url, genero, morada, bairro, regiao, 
                bi_ou_cedula, nif_pessoal, data_nascimento, data_admissao, data_validade_bi, 
                entidade_emissao_bi, nacionalidade, estado_civil, numero_filhos, iban, 
                nivel_estudo, area_estudo, cargo, observacoes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        escola_id, userId, polo_id || null, fotoProcessada || null, genero || null, morada || null, bairro || null, regiao || null,
        bi_ou_passaporte || null, nif_pessoal || null, data_nascimento || null, data_admissao || null, data_validade_bi || null,
        entidade_emissao_bi || null, nacionalidade || 'Guiné-Bissau', estado_civil || null,
        numero_filhos !== undefined && numero_filhos !== '' ? parseInt(numero_filhos, 10) : 0,
        iban || null, nivel_estudo || null, area_estudo || null, cargo || null, observacoes || null
      ]
    );

    if (papelLower === 'professor') {
      await client.query(
        `INSERT INTO professores_detalhes ( 
                    utilizador_id, escola_id, habilitacao_literaria, especialidade, grau_academico, anos_experiencia, observacoes,
                    escola_estudio_prof, anos_experiencia_prof, campo_estudo_prof, nota_final_prof
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId, escola_id, nivel_estudo || null, area_estudo || null, null,
          anos_experiencia_prof !== undefined && anos_experiencia_prof !== '' ? parseInt(anos_experiencia_prof, 10) : null,
          observacoes || null, escola_estudio_prof || null,
          anos_experiencia_prof !== undefined && anos_experiencia_prof !== '' ? parseInt(anos_experiencia_prof, 10) : null,
          campo_estudo_prof || null, nota_final_prof || null
        ]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      message: `Funcionário criado com sucesso. Login: ${loginId}`,
      data: { id: userId, login_id: loginId, password_temporaria: passwordTemporaria }
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => { });
    console.error("Erro ao criar funcionário:", error);
    return res.status(500).json({ success: false, message: error.message || "Erro interno ao registar funcionário." });
  } finally {
    client?.release();
  }
});

// ============================================================
// 2. ROTA: ALTERAR ESTADO (Ativar / Desativar Conta)
// ============================================================
router.patch('/funcionarios/:id/status', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const { status_ativo } = req.body;

    if (status_ativo === undefined) { return res.status(400).json({ success: false, message: "O estado 'status_ativo' é obrigatório." }); }

    const result = await db.query(
      `UPDATE utilizadores SET status_ativo = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, status_ativo`,
      [status_ativo, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Utilizador não encontrado." });
    }

    return res.json({ success: true, message: `Conta ${status_ativo ? 'ativada' : 'desativada'} com sucesso.` });
  } catch (error) {
    console.error("Erro ao alterar estado da conta:", error);
    return res.status(500).json({ success: false, message: "Erro ao alterar estado da conta." });
  }
});

// ============================================================
// ROTA: EDITAR FUNCIONÁRIO (Completa, Otimizada e Protegida contra NaN)
// ============================================================
router.put('/funcionarios/:id', verificarAutenticacao, async (req, res) => {
    let client;
    try {
        const { id } = req.params; // ID do utilizador
        const { 
            escola_id, nome, email, telefone, foto_url, genero, morada, papel,
            bi_ou_passaporte, status_ativo, polo_id, nif_pessoal, bairro, 
            regiao, data_nascimento, data_validade_bi, entidade_emissao_bi, 
            nacionalidade, estado_civil, numero_filhos, iban, nivel_estudo, 
            area_estudo, escola_estudio_prof, anos_experiencia_prof, 
            campo_estudo_prof, nota_final_prof, observacoes 
        } = req.body || {};

        if (!escola_id) {return res.status(400).json({ success: false, message: "ID da escola em falta." });}
        const papelNormalizado = typeof papel === 'string' ? papel.trim().toLowerCase() : '';
        if (!['secretaria', 'tesouraria', 'professor'].includes(papelNormalizado)) {
            return res.status(400).json({ success: false, message: "Cargo / Papel institucional inválido." });
        }

        // Função auxiliar para evitar o erro "NaN" no PostgreSQL
        const parseInteiroSeguro = (valor) => {
            if (valor === undefined || valor === null || valor === '') return null;
            const num = parseInt(valor, 10);
            return isNaN(num) ? null : num;
        };

        client = await db.connect();
        await client.query('BEGIN');

        // 1. Atualizar tabela 'utilizadores'
        await client.query(
            `UPDATE utilizadores 
             SET nome = COALESCE($1, nome), 
                 email = COALESCE($2, email), 
                 telefone = COALESCE($3, telefone), 
                 status_ativo = COALESCE($4, status_ativo), 
                 atualizado_em = CURRENT_TIMESTAMP 
             WHERE id = $5`,
            [
                nome?.trim() || null, 
                email?.trim() || null, 
                telefone?.trim() || null, 
                status_ativo !== undefined ? status_ativo : null, 
                id
            ]
        );

        // Processar nova foto se houver
        let fotoProcessada = foto_url;
        if (foto_url && foto_url.startsWith('data:image')) {
            fotoProcessada = await comprimirImagemParaLimite(foto_url);
        }

        // 2. Atualizar tabela 'funcionarios'
        await client.query(
            `UPDATE funcionarios 
             SET polo_id = $1, 
                 foto_url = COALESCE(NULLIF($2, ''), foto_url), 
                 genero = COALESCE($3, genero), 
                 morada = COALESCE($4, morada), 
                 bi_ou_cedula = COALESCE($5, bi_ou_cedula), 
                 data_nascimento = COALESCE($6, data_nascimento), 
                 data_validade_bi = COALESCE($7, data_validade_bi), 
                 entidade_emissao_bi = COALESCE($8, entidade_emissao_bi), 
                 nacionalidade = COALESCE($9, nacionalidade), 
                 estado_civil = COALESCE($10, estado_civil), 
                 numero_filhos = COALESCE($11, numero_filhos), 
                 iban = COALESCE($12, iban), 
                 nivel_estudo = COALESCE($13, nivel_estudo), 
                 area_estudo = COALESCE($14, area_estudo), 
                 nif_pessoal = COALESCE($15, nif_pessoal), 
                 bairro = COALESCE($16, bairro), 
                 regiao = COALESCE($17, regiao), 
                 observacoes = COALESCE($18, observacoes), 
                 atualizado_em = CURRENT_TIMESTAMP 
             WHERE utilizador_id = $19 AND escola_id = $20`,
            [
                polo_id === '' || !polo_id ? null : polo_id,                         // $1
                fotoProcessada || null,                                             // $2
                genero || null,                                                     // $3
                morada || null,                                                     // $4
                bi_ou_passaporte || null,                                           // $5
                data_nascimento || null,                                            // $6
                data_validade_bi || null,                                           // $7
                entidade_emissao_bi || null,                                        // $8
                nacionalidade || null,                                              // $9
                estado_civil || null,                                               // $10
                parseInteiroSeguro(numero_filhos),                                  // $11 (Protegido contra NaN)
                iban || null,                                                       // $12
                nivel_estudo || null,                                               // $13
                area_estudo || null,                                                // $14
                nif_pessoal || null,                                                // $15
                bairro || null,                                                     // $16
                regiao || null,                                                     // $17
                observacoes || null,                                                // $18
                id,                                                                 // $19 (utilizador_id)
                escola_id                                                           // $20 (escola_id)
            ]
        );

        const papelRes = await client.query(
            `UPDATE papeis_utilizador
             SET papel = $1
             WHERE associacao_id IN (
               SELECT id FROM associacoes_escola
               WHERE utilizador_id = $2 AND escola_id = $3 AND status = 'ativo'
             )`,
            [papelNormalizado, id, escola_id]
        );
        if (papelRes.rowCount === 0) {
            throw new Error('Associação do funcionário à escola não encontrada.');
        }

        const anosExpSeguro = parseInteiroSeguro(anos_experiencia_prof);
        if (papelNormalizado === 'professor') {
            const professorRes = await client.query(
                `SELECT 1 FROM professores_detalhes
                 WHERE utilizador_id = $1 AND escola_id = $2
                 LIMIT 1`,
                [id, escola_id]
            );
            const dadosProfessor = [
                nivel_estudo || null,
                area_estudo || null,
                anosExpSeguro,
                observacoes || null,
                escola_estudio_prof || null,
                anosExpSeguro,
                campo_estudo_prof || null,
                nota_final_prof || null
            ];

            if (professorRes.rowCount > 0) {
                await client.query(
                    `UPDATE professores_detalhes
                     SET habilitacao_literaria = $1,
                         especialidade = $2,
                         anos_experiencia = $3,
                         observacoes = $4,
                         escola_estudio_prof = $5,
                         anos_experiencia_prof = $6,
                         campo_estudo_prof = $7,
                         nota_final_prof = $8
                     WHERE utilizador_id = $9 AND escola_id = $10`,
                    [...dadosProfessor, id, escola_id]
                );
            } else {
                await client.query(
                    `INSERT INTO professores_detalhes (
                       utilizador_id, escola_id, habilitacao_literaria, especialidade,
                       grau_academico, anos_experiencia, observacoes, escola_estudio_prof,
                       anos_experiencia_prof, campo_estudo_prof, nota_final_prof
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        id,
                        escola_id,
                        nivel_estudo || null,
                        area_estudo || null,
                        null,
                        anosExpSeguro,
                        observacoes || null,
                        escola_estudio_prof || null,
                        anosExpSeguro,
                        campo_estudo_prof || null,
                        nota_final_prof || null
                    ]
                );
            }
        }

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Dados do funcionário atualizados com sucesso.' });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error('Erro ao editar funcionário:', error);
        return res.status(500).json({ success: false, message: error.message || 'Erro ao atualizar dados do funcionário.' });
    } finally {
        if (client) client.release();
    }
});

// ============================================================
// ROTA: LER DETALHES DE UM ÚNICO FUNCIONÁRIO
// ============================================================
router.get('/funcionarios/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
            SELECT 
                u.id, u.nome, u.email, u.telefone, u.login_id, u.status_ativo,
                f.id AS funcionario_id, f.foto_url, f.genero, f.morada, f.bi_ou_cedula AS bi_ou_passaporte,
                f.escola_id, f.polo_id, f.bairro, f.regiao, f.nif_pessoal, f.data_nascimento, f.data_validade_bi, f.entidade_emissao_bi,
                f.nacionalidade, f.estado_civil, f.numero_filhos, f.iban, f.nivel_estudo, f.area_estudo,
                p.nome AS polo_nome, p.codigo AS polo_codigo, pu.papel, 
                pd.escola_estudio_prof, pd.anos_experiencia_prof, pd.campo_estudo_prof, pd.nota_final_prof,
                COALESCE(f.observacoes, pd.observacoes) AS observacoes
            FROM utilizadores u 
            JOIN funcionarios f ON f.utilizador_id = u.id 
            JOIN associacoes_escola ae ON ae.utilizador_id = u.id AND ae.escola_id = f.escola_id 
            JOIN papeis_utilizador pu ON pu.associacao_id = ae.id 
            LEFT JOIN polos_escola p ON p.id = f.polo_id 
            LEFT JOIN professores_detalhes pd ON pd.utilizador_id = u.id AND pd.escola_id = f.escola_id 
            WHERE u.id = $1 AND ae.status = 'ativo' 
            LIMIT 1;
        `;
    const resultado = await db.query(query, [id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Funcionário não encontrado." });
    }
    return res.json({ success: true, data: resultado.rows[0] });
  } catch (error) {
    console.error("Erro ao buscar funcionário:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao carregar dados do funcionário." });
  }
});

// ============================================================
// ROTA: LISTAR FUNCIONÁRIOS DA ESCOLA (Super Otimizada e Leve)
// ============================================================
router.get('/escolas/:escolaId/funcionarios', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const query = `
            SELECT 
                u.id, 
                u.nome, 
                u.email, 
                u.telefone, 
                u.login_id, 
                u.status_ativo,
                f.id AS funcionario_id, 
                f.foto_url, 
                f.genero, 
                f.polo_id, 
                p.nome AS polo_nome, -- Ajusta para p.nome se a tua coluna for em português
                p.codigo AS polo_codigo, 
                pu.papel
            FROM funcionarios f 
            JOIN utilizadores u ON u.id = f.utilizador_id 
            JOIN associacoes_escola ae ON ae.utilizador_id = u.id AND ae.escola_id = f.escola_id 
            JOIN papeis_utilizador pu ON pu.associacao_id = ae.id 
            LEFT JOIN polos_escola p ON p.id = f.polo_id 
            WHERE f.escola_id = $1 AND ae.status = 'ativo'
            ORDER BY u.nome ASC;
        `;

    const resultado = await db.query(query, [escolaId]);

    return res.json({
      success: true,
      total: resultado.rowCount,
      data: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar funcionários da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar a lista de funcionários." });
  }
});


// 3. POLOS DAS ESCOLAS --------------------------------------------------------------------------------------------

router.get('/escolas/:escolaId/polos', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeAcederEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    const resultado = await db.query(
      `SELECT id, escola_id, nome, codigo, endereco, local, telefone, ativo
       FROM polos_escola
       WHERE escola_id = $1
       ORDER BY nome ASC`,
      [escolaId]
    );
    const niveisEscola = await obterNiveisEnsinoEscola(escolaId);
    const polos = resultado.rows.map((polo) => ({
      ...polo,
      classes: classesDoPolo(polo, niveisEscola)
    }));

    return res.json({
      success: true,
      total: polos.length,
      data: polos
    });
  } catch (error) {
    console.error("Erro ao listar polos da escola:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao carregar os polos da escola."
    });
  }
});

// ============================================================
// ROTA: ALTERAR PASSWORD (Utilizador Autenticado)
// ============================================================
router.post('/utilizadores/alterar-senha', verificarAutenticacao, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { senha_atual, nova_senha } = req.body || {};

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Sessão autenticada não identificada.' });
    }
    if (typeof senha_atual !== 'string' || !senha_atual
      || typeof nova_senha !== 'string' || !nova_senha) {
      return res.status(400).json({ success: false, message: "A senha atual e a nova senha são obrigatórias." });
    }

    if (nova_senha.length < 6 || nova_senha.length > 128) {
      return res.status(400).json({ success: false, message: "A nova senha deve ter entre 6 e 128 caracteres." });
    }

    // Buscar hash atual do utilizador
    const userRes = await db.query(`SELECT password_hash FROM utilizadores WHERE id = $1`, [userId]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Utilizador não encontrado." });
    }

    const senhaHashAtual = userRes.rows[0].password_hash;

    // Verificar se a senha atual está correta
    const senhaCorreta = await verifyPassword(senha_atual, senhaHashAtual);
    if (!senhaCorreta) {
      return res.status(400).json({ success: false, message: "A senha atual está incorreta." });
    }

    // Gerar novo hash para a nova senha
    const novoHash = await hashPassword(nova_senha);

    await db.query(
      `UPDATE utilizadores SET password_hash = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2`,
      [novoHash, userId]
    );

    return res.json({
      success: true,
      message: "Palavra-passe alterada com sucesso."
    });

  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    return res.status(500).json({ success: false, message: "Erro interno ao alterar a palavra-passe." });
  }
});


// ============================================================
// ROTAS DE PARÂMETROS DE AVALIAÇÃO DA ESCOLA
// ============================================================
router.get('/escolas/:escolaId/parametros-avaliacao', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!req.user?.isOwner && req.contaAtiva?.escola_id !== escolaId) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }

    const resultado = await db.query(
      `SELECT * FROM parametros_avaliacao WHERE escola_id = $1 LIMIT 1`,
      [escolaId]
    );

    if (resultado.rowCount === 0) {
      return res.json({
        success: true,
        data: {
          sistema_periodo: 'trimestres',
          escala_nota: '0-20',
          tipo_prova_final: 'trimestres',
          racio_continua: 40,
          racio_fixo: 60,
          nome_metrico_1: 'Asiduidade',
          nome_metrico_2: 'Notas',
          nome_metrico_3: 'Trabalho da casa (TDC)',
          nome_metrico_4: 'Prática'
        }
      });
    }

    return res.json({ success: true, data: resultado.rows[0] });
  } catch (error) {
    console.error("Erro ao carregar parâmetros de avaliação:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar parâmetros de avaliação." });
  }
});

// POST/PUT: Guardar ou atualizar parâmetros de avaliação
router.post('/escolas/:escolaId/parametros-avaliacao', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { escolaId } = req.params;
    const {
      sistema_periodo,
      escala_nota,
      tipo_prova_final,
      racio_continua,
      racio_fixo,
      nome_metrico_1,
      nome_metrico_2,
      nome_metrico_3,
      nome_metrico_4
    } = req.body || {};

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeGerirConfiguracoesEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar as configurações desta escola." });
    }
    if (!['trimestres', 'semestres'].includes(sistema_periodo) || !['0-20', '0-100'].includes(escala_nota)) {
      return res.status(400).json({ success: false, message: 'Sistema de períodos ou escala de notas inválidos.' });
    }

    const rCont = Number(racio_continua);
    const rFix = Number(racio_fixo);
    const tipoProva = ['trimestres', 'anual'].includes(tipo_prova_final)
      ? tipo_prova_final
      : 'trimestres';
    const metricos = [nome_metrico_1, nome_metrico_2, nome_metrico_3, nome_metrico_4];
    if (
      !Number.isInteger(rCont) || rCont < 0 || rCont > 100 ||
      !Number.isInteger(rFix) || rFix < 0 || rFix > 100 ||
      rCont + rFix !== 100 ||
      metricos.some((nome) => typeof nome !== 'string' || !nome.trim() || nome.length > 80)
    ) {
      return res.status(400).json({ success: false, message: 'Informe rácios que somem 100 e os quatro nomes dos métricos (até 80 caracteres).' });
    }

    client = await db.connect();
    await client.query('BEGIN');

    const queryUpsert = `
            INSERT INTO parametros_avaliacao (
                escola_id, sistema_periodo, escala_nota,
                tipo_prova_final,
                racio_continua, racio_fixo,
                nome_metrico_1, nome_metrico_2, nome_metrico_3, nome_metrico_4,
                atualizado_em
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP) 
            ON CONFLICT (escola_id) 
            DO UPDATE SET 
                sistema_periodo = COALESCE($2, parametros_avaliacao.sistema_periodo), 
                escala_nota = COALESCE($3, parametros_avaliacao.escala_nota),
                tipo_prova_final = $4,
                racio_continua = $5,
                racio_fixo = $6,
                nome_metrico_1 = $7,
                nome_metrico_2 = $8,
                nome_metrico_3 = $9,
                nome_metrico_4 = $10,
                atualizado_em = CURRENT_TIMESTAMP 
            RETURNING *;
        `;

    const resultado = await client.query(queryUpsert, [
      escolaId,
      sistema_periodo,
      escala_nota,
      tipoProva,
      rCont,
      rFix,
      ...metricos.map((nome) => nome.trim())
    ]);
    const periodosSincronizados = await sincronizarPeriodosLetivos(client, escolaId, sistema_periodo);

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: `Parâmetros atualizados com sucesso. ${periodosSincronizados} períodos sincronizados.`,
      data: resultado.rows[0],
      periodos_sincronizados: periodosSincronizados
    });

  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => { });
    console.error("Erro ao salvar parâmetros de avaliação:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar parâmetros." });
  } finally {
    client?.release();
  }
});

// ============================================================
// ROTAS DE PRAZOS DE MATRÍCULA
// ============================================================

// GET: Ver prazos de matrícula da escola
router.get('/:escolaId/prazos-matricula', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeAcederEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    const resultado = await db.query(
      `SELECT pm.*, al.ano_nome
       FROM prazos_matricula pm
       JOIN anos_letivos al ON al.id = pm.anos_letivo_id
       WHERE pm.escola_id = $1 ORDER BY pm.data_inicio DESC`,
      [escolaId]
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error("Erro ao carregar prazos de matrícula:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar prazos de matrícula." });
  }
});

// POST / PUT: Definir ou atualizar prazo de matrícula
router.post('/:escolaId/prazos-matricula', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { anos_letivo_id, data_inicio, data_fim, ativo } = req.body || {};

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeGerirConfiguracoesEscola(req, escolaId)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode definir os prazos de matrícula desta escola." });
    }
    if (!UUID_PATTERN.test(anos_letivo_id || '')) {
      return res.status(400).json({ success: false, message: "Selecione um ano letivo global válido." });
    }
    if (typeof data_inicio !== 'string' || typeof data_fim !== 'string') {
      return res.status(400).json({ success: false, message: "As datas de início e fim são obrigatórias." });
    }
    const dataInicioValida = /^\d{4}-\d{2}-\d{2}$/.test(data_inicio)
      && !Number.isNaN(Date.parse(data_inicio))
      && new Date(`${data_inicio}T00:00:00Z`).toISOString().slice(0, 10) === data_inicio;
    const dataFimValida = /^\d{4}-\d{2}-\d{2}$/.test(data_fim)
      && !Number.isNaN(Date.parse(data_fim))
      && new Date(`${data_fim}T00:00:00Z`).toISOString().slice(0, 10) === data_fim;
    if (!dataInicioValida || !dataFimValida || data_inicio > data_fim) {
      return res.status(400).json({ success: false, message: "O intervalo de datas do prazo de matrícula é inválido." });
    }
    if (ativo !== undefined && typeof ativo !== 'boolean') {
      return res.status(400).json({ success: false, message: "O estado ativo deve ser verdadeiro ou falso." });
    }

    const anoAssociado = await db.query(
      `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
      [escolaId, anos_letivo_id]
    );
    if (!anoAssociado.rowCount) {
      return res.status(400).json({ success: false, message: "Associe primeiro o ano letivo à escola antes de definir o prazo de matrícula." });
    }

    const query = `
      INSERT INTO prazos_matricula (escola_id, anos_letivo_id, data_inicio, data_fim, ativo)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const resultado = await db.query(query, [escolaId, anos_letivo_id, data_inicio, data_fim, ativo ?? true]);

    return res.status(201).json({
      success: true,
      message: "Prazo de matrícula configurado com sucesso.",
      data: resultado.rows[0]
    });
  } catch (error) {
    console.error("Erro ao salvar prazo de matrícula:", error);
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: "A escola ou o ano letivo selecionado não existe." });
    }
    return res.status(500).json({ success: false, message: "Erro ao registar prazo de matrícula." });
  }
});

router.put('/prazos-matricula/:id', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const { anos_letivo_id, data_inicio, data_fim, ativo } = req.body || {};
    if (!req.contaAtiva?.escola_id) {
      return res.status(403).json({ success: false, message: "Escola ativa não identificada." });
    }
    if (!podeGerirConfiguracoesEscola(req, req.contaAtiva.escola_id)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar os prazos de matrícula desta escola." });
    }
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(anos_letivo_id || '')) {
      return res.status(400).json({ success: false, message: "Identificador do prazo ou ano letivo inválido." });
    }
    if (!dataValida(data_inicio) || !dataValida(data_fim) || data_inicio > data_fim ||
      ativo !== undefined && typeof ativo !== 'boolean') {
      return res.status(400).json({ success: false, message: "Informe um intervalo de datas válido e um estado ativo booleano." });
    }
    const anoAssociado = await db.query(
      `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
      [req.contaAtiva.escola_id, anos_letivo_id]
    );
    if (!anoAssociado.rowCount) {
      return res.status(400).json({ success: false, message: "Associe primeiro o ano letivo à escola antes de definir o prazo de matrícula." });
    }
    const resultado = await db.query(
      `UPDATE prazos_matricula pm SET
         anos_letivo_id = $1,
         data_inicio = $2,
         data_fim = $3,
         ativo = COALESCE($4, pm.ativo),
         atualizado_em = CURRENT_TIMESTAMP
       WHERE pm.id = $5 AND pm.escola_id = $6
       RETURNING pm.*`,
      [anos_letivo_id, data_inicio, data_fim, ativo ?? null, id, req.contaAtiva?.escola_id]
    );
    if (!resultado.rowCount) {
      return res.status(404).json({ success: false, message: "Prazo não encontrado nesta escola." });
    }
    return res.json({ success: true, message: "Prazo de matrícula atualizado com sucesso.", data: resultado.rows[0] });
  } catch (error) {
    console.error("Erro ao atualizar prazo de matrícula:", error);
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: "O ano letivo selecionado não existe." });
    }
    return res.status(500).json({ success: false, message: "Erro ao atualizar prazo de matrícula." });
  }
});

// ============================================================
// ROTA: EDITAR INFORMAÇÕES GERAIS DA ESCOLA (Pela Direção)
// ============================================================
router.put('/:id/configuracoes', verificarAutenticacao, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome,
      sigla,
      logo_url,
      cor_primaria,
      motto,
      visao,
      sector,
      local,
      endereco,
      regime_periodo
    } = req.body || {};

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!podeGerirConfiguracoesEscola(req, id)) {
      return res.status(403).json({ success: false, message: "Apenas a Direção pode alterar as configurações desta escola." });
    }
    if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 255 ||
      typeof sigla !== 'string' || !sigla.trim() || sigla.trim().length > 50) {
      return res.status(400).json({ success: false, message: "O nome da escola e a sigla são obrigatórios e devem respeitar os limites de tamanho." });
    }
    if (logo_url !== undefined && logo_url !== null && typeof logo_url !== 'string' ||
      cor_primaria !== undefined && cor_primaria !== null && (typeof cor_primaria !== 'string' || cor_primaria.length > 10) ||
      motto !== undefined && motto !== null && (typeof motto !== 'string' || motto.length > 255) ||
      visao !== undefined && visao !== null && typeof visao !== 'string' ||
      sector !== undefined && sector !== null && (typeof sector !== 'string' || sector.length > 100) ||
      local !== undefined && local !== null && (typeof local !== 'string' || local.length > 100) ||
      endereco !== undefined && endereco !== null && (typeof endereco !== 'string' || endereco.length > 255) ||
      regime_periodo !== undefined && regime_periodo !== null && (typeof regime_periodo !== 'string' || regime_periodo.length > 20)) {
      return res.status(400).json({ success: false, message: "Um ou mais campos excedem o limite permitido ou são inválidos." });
    }

    const query = `
      UPDATE escolas SET
        nome = $1,
        sigla = $2,
        logo_url = $3,
        cor_primaria = $4,
        motto = $5,
        visao = $6,
        sector = $7,
        local = $8,
        endereco = $9,
        regime_periodo = $10,
        atualizado_em = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *;
    `;

    const resultado = await db.query(query, [
      nome.trim(),
      sigla.trim().toUpperCase(),
      logo_url?.trim() || null,
      cor_primaria?.trim() || null,
      motto?.trim() || null,
      visao?.trim() || null,
      sector?.trim() || null,
      local?.trim() || null,
      endereco?.trim() || null,
      regime_periodo?.trim() || null,
      id
    ]);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Escola não encontrada." });
    }

    return res.json({
      success: true,
      message: "Configurações da escola atualizadas com sucesso.",
      data: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao atualizar configurações da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar dados da escola." });
  }
});



// -------------------------TURMAS---------------------------

router.get('/:escolaId/turmas', verificarAutenticacao, async (req, res) => {
  const { escolaId } = req.params;
  const { ano_letivo_id, polo_id } = req.query;
  if (!UUID_PATTERN.test(escolaId)) {
    return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
  }
  if (req.contaAtiva?.escola_id !== escolaId) {
    return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
  }
  if (polo_id && !UUID_PATTERN.test(polo_id)) {
    return res.status(400).json({ success: false, message: "Identificador do polo inválido." });
  }
  if (ano_letivo_id && !UUID_PATTERN.test(ano_letivo_id)) {
    return res.status(400).json({ success: false, message: "Identificador do ano letivo inválido." });
  }

  try {
    const params = [escolaId];
    const filters = ['t.escola_id = $1', 't.ativo = true', 'p.ativo = true'];
    if (polo_id) {
      params.push(polo_id);
      filters.push(`t.polo_id = $${params.length}`);
    }
    if (ano_letivo_id) {
      params.push(ano_letivo_id);
      filters.push(`t.ano_letivo_id = $${params.length}`);
    }
    const resultado = await db.query(
      `SELECT t.*, p.nome AS polo_nome, p.codigo AS polo_codigo,
              al.ano_nome AS ano_letivo,
              COUNT(DISTINCT at.aluno_id)::integer AS total_alunos
       FROM turmas t
       JOIN polos_escola p ON p.id = t.polo_id
       LEFT JOIN anos_letivos al ON al.id = t.ano_letivo_id
       LEFT JOIN alunos_turmas at
         ON at.turma_id = t.id
        AND at.ano_letivo_id = t.ano_letivo_id
        AND at.status = 'ativo'
       WHERE ${filters.join(' AND ')}
       GROUP BY t.id, p.id, al.ano_nome
       ORDER BY p.nome ASC, t.classe ASC, t.nome ASC`,
      params
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error("Erro ao listar turmas da escola:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar as turmas da escola." });
  }
});

// ============================================================
// 1. ROTA: CRIAR UMA NOVA TURMA
// ============================================================
router.post('/:escolaId/turmas', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { escolaId } = req.params;
    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (req.contaAtiva?.escola_id !== escolaId) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    const {
      nome,
      classe,
      polo_id,
      ano_letivo_id,
      turno,             // 'Manhã', 'Tarde', 'Noite'
      sala,              // Ex: Sala 04
      capacidade         // Ex: 45
    } = req.body || {};

    if (typeof nome !== 'string' || !nome.trim()
      || typeof classe !== 'string' || !classe.trim()
      || !UUID_PATTERN.test(polo_id || '')
      || !UUID_PATTERN.test(ano_letivo_id || '')) {
      return res.status(400).json({
        success: false,
        message: "Informe nome, classe, polo e ano letivo válidos."
      });
    }
    if (turno !== undefined && !['Manhã', 'Tarde', 'Noite', 'Regime Integral'].includes(turno)) {
      return res.status(400).json({ success: false, message: "Selecione um turno válido." });
    }
    if (sala !== undefined && sala !== null && typeof sala !== 'string') {
      return res.status(400).json({ success: false, message: "O nome da sala deve ser texto." });
    }
    const capacidadeNumerica = capacidade === undefined || capacidade === '' ? 45 : Number(capacidade);
    if (!Number.isInteger(capacidadeNumerica) || capacidadeNumerica < 1) {
      return res.status(400).json({ success: false, message: "A capacidade deve ser um número inteiro maior que zero." });
    }

    const poloDaEscola = await db.query(
      `SELECT id, codigo, nome FROM polos_escola WHERE id = $1 AND escola_id = $2 AND ativo = true`,
      [polo_id, escolaId]
    );
    if (poloDaEscola.rowCount === 0) {
      return res.status(400).json({ success: false, message: "O polo selecionado não pertence a esta escola ou está inativo." });
    }
    const anoDaEscola = await db.query(
      `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
      [escolaId, ano_letivo_id]
    );
    if (anoDaEscola.rowCount === 0) {
      return res.status(400).json({ success: false, message: "O ano letivo selecionado não está configurado para esta escola." });
    }
    const niveisEscola = await obterNiveisEnsinoEscola(escolaId);
    const classesDisponiveis = classesDoPolo(poloDaEscola.rows[0], niveisEscola);
    if (!classesDisponiveis.includes(classe.trim())) {
      return res.status(400).json({ success: false, message: "Selecione uma classe compatível com o ramo escolhido." });
    }

    client = await db.connect();
    await client.query("BEGIN");

    const query = `
      INSERT INTO turmas (
        escola_id, 
        polo_id, 
        ano_letivo_id,
        classe,
        nome, 
        turno, 
        sala, 
        capacidade, 
        ativo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING *;
    `;

    const resultado = await client.query(query, [
      escolaId,
      polo_id,
      ano_letivo_id,
      classe.trim(),
      nome.trim(),
      turno || 'Manhã',
      sala || null,
      capacidadeNumerica
    ]);

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Turma criada com sucesso.",
      data: resultado.rows[0]
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => { });
    console.error("Erro ao criar turma:", error);
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: "Um dos dados selecionados já não existe. Atualize a página e tente novamente." });
    }
    return res.status(500).json({ success: false, message: "Erro interno ao criar a turma." });
  } finally {
    client?.release();
  }
});


// ============================================================
// 2. ROTA: ATRIBUIR OU MUDAR O DIRETOR DE TURMA
// ============================================================
router.put('/turmas/:turmaId', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { turmaId } = req.params;
    const { nome, classe, polo_id, ano_letivo_id, turno, sala, capacidade, diretor_turma_id } = req.body || {};
    const escolaId = req.contaAtiva?.escola_id;

    if (!UUID_PATTERN.test(turmaId) || !UUID_PATTERN.test(escolaId || '')
      || !UUID_PATTERN.test(polo_id || '') || !UUID_PATTERN.test(ano_letivo_id || '')) {
      return res.status(400).json({ success: false, message: "Identificadores da turma, escola, polo ou ano letivo inválidos." });
    }
    if (typeof nome !== 'string' || !nome.trim() || typeof classe !== 'string' || !classe.trim()) {
      return res.status(400).json({ success: false, message: "O nome e a classe da turma são obrigatórios." });
    }
    if (turno !== undefined && !['Manhã', 'Tarde', 'Noite', 'Regime Integral'].includes(turno)) {
      return res.status(400).json({ success: false, message: "Selecione um turno válido." });
    }
    const capacidadeNumerica = capacidade === undefined || capacidade === '' ? 45 : Number(capacidade);
    if (!Number.isInteger(capacidadeNumerica) || capacidadeNumerica < 1) {
      return res.status(400).json({ success: false, message: "A capacidade deve ser um número inteiro maior que zero." });
    }

    const poloRes = await db.query(
      `SELECT id, codigo, nome FROM polos_escola WHERE id = $1 AND escola_id = $2 AND ativo = true`,
      [polo_id, escolaId]
    );
    const niveisEscola = await obterNiveisEnsinoEscola(escolaId);
    if (poloRes.rowCount === 0 || !classesDoPolo(poloRes.rows[0], niveisEscola).includes(classe.trim())) {
      return res.status(400).json({ success: false, message: "O polo não pertence a esta escola ou a classe não é compatível." });
    }

    const anoRes = await db.query(
      `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
      [escolaId, ano_letivo_id]
    );
    if (anoRes.rowCount === 0) {
      return res.status(400).json({ success: false, message: "O ano letivo selecionado não está configurado para esta escola." });
    }
    if (diretor_turma_id !== undefined && diretor_turma_id !== null && diretor_turma_id !== ''
      && !UUID_PATTERN.test(diretor_turma_id)) {
      return res.status(400).json({ success: false, message: "O diretor de turma selecionado é inválido." });
    }

    client = await db.connect();
    await client.query('BEGIN');
    const turmaAtual = await client.query(
      `SELECT ano_letivo_id
       FROM turmas
       WHERE id = $1 AND escola_id = $2 AND ativo = true
       FOR UPDATE`,
      [turmaId, escolaId]
    );
    if (turmaAtual.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Turma não encontrada nesta escola." });
    }
    if (turmaAtual.rows[0].ano_letivo_id !== ano_letivo_id) {
      const matriculasExistentes = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM matriculas
            WHERE turma_id = $1 AND escola_id = $2) +
           (SELECT COUNT(*) FROM alunos_turmas
            WHERE turma_id = $1) AS total`,
        [turmaId, escolaId]
      );
      if (Number(matriculasExistentes.rows[0].total) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: "Não é possível mudar o ano letivo de uma turma com histórico de matrículas. Crie uma turma no ano pretendido para preservar os registos existentes."
        });
      }
    }
    const resultado = await client.query(
      `UPDATE turmas
       SET nome = $1, classe = $2, polo_id = $3, ano_letivo_id = $4,
           turno = $5, sala = $6, capacidade = $7,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $8 AND escola_id = $9 AND ativo = true
       RETURNING *`,
      [nome.trim(), classe.trim(), polo_id, ano_letivo_id, turno || 'Manhã', sala || null, capacidadeNumerica, turmaId, escolaId]
    );
    if (resultado.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Turma não encontrada nesta escola." });
    }

    if (diretor_turma_id !== undefined) {
      const diretorId = diretor_turma_id || null;
      if (diretorId) {
        const professor = await client.query(
          `SELECT f.id
           FROM funcionarios f
           JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
           JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
           JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
           WHERE f.id = $1 AND f.escola_id = $2
             AND ae.status = 'ativo' AND LOWER(TRIM(pu.papel)) = 'professor'
           LIMIT 1`,
          [diretorId, escolaId]
        );
        if (professor.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: "O diretor selecionado não é um professor ativo desta escola." });
        }
      }

      const atual = await client.query(
        `SELECT professor_id FROM diretores_turma
         WHERE turma_id = $1 AND data_fim IS NULL
         ORDER BY data_inicio DESC LIMIT 1 FOR UPDATE`,
        [turmaId]
      );
      if (atual.rows[0]?.professor_id !== diretorId) {
        await client.query(
          `UPDATE diretores_turma
           SET data_fim = CURRENT_DATE
           WHERE turma_id = $1 AND data_fim IS NULL`,
          [turmaId]
        );
        if (diretorId) {
          await client.query(
            `INSERT INTO diretores_turma (turma_id, professor_id, data_inicio)
             VALUES ($1, $2, CURRENT_DATE)`,
            [turmaId, diretorId]
          );
        }
      }
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: "Turma atualizada com sucesso.", data: resultado.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error("Erro ao atualizar turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao atualizar a turma." });
  } finally {
    client?.release();
  }
});

router.delete('/turmas/:turmaId', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { turmaId } = req.params;
    const escolaId = req.contaAtiva?.escola_id;
    if (!UUID_PATTERN.test(turmaId || '') || !UUID_PATTERN.test(escolaId || '')) {
      return res.status(400).json({ success: false, message: "Identificador da turma ou escola inválido." });
    }

    client = await db.connect();
    await client.query('BEGIN');
    const turma = await client.query(
      `SELECT id FROM turmas
       WHERE id = $1 AND escola_id = $2 AND ativo = true
       FOR UPDATE`,
      [turmaId, escolaId]
    );
    if (turma.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Turma não encontrada ou já desativada." });
    }

    const matriculasAtivas = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM matriculas
          WHERE turma_id = $1 AND escola_id = $2 AND estado = 'ativa') +
         (SELECT COUNT(*) FROM alunos_turmas
          WHERE turma_id = $1 AND status = 'ativo') AS total`,
      [turmaId, escolaId]
    );
    if (Number(matriculasAtivas.rows[0].total) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: "Não é possível apagar esta turma enquanto tiver alunos ativos. Transfira ou encerre as matrículas primeiro."
      });
    }

    await client.query(
      `UPDATE turmas
       SET ativo = false, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $1 AND escola_id = $2`,
      [turmaId, escolaId]
    );
    await client.query(
      `UPDATE diretores_turma
       SET data_fim = CURRENT_DATE
       WHERE turma_id = $1 AND data_fim IS NULL`,
      [turmaId]
    );
    await client.query(
      `UPDATE turma_disciplinas
       SET ativo = false, atualizado_em = CURRENT_TIMESTAMP
       WHERE turma_id = $1 AND escola_id = $2 AND ativo = true`,
      [turmaId, escolaId]
    );
    await client.query('COMMIT');
    return res.json({ success: true, message: "Turma desativada. O histórico académico foi preservado." });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error("Erro ao desativar turma:", error);
    return res.status(500).json({ success: false, message: "Não foi possível apagar a turma." });
  } finally {
    client?.release();
  }
});

router.post('/turmas/:turmaId/diretor', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { turmaId } = req.params;
    const { professor_id } = req.body || {};

    if (!UUID_PATTERN.test(turmaId) || !UUID_PATTERN.test(professor_id || '')) {
      return res.status(400).json({ success: false, message: "O professor responsável é obrigatório." });
    }

    const turma = await db.query(`SELECT escola_id FROM turmas WHERE id = $1 AND ativo = true`, [turmaId]);
    if (turma.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Turma não encontrada." });
    }
    if (req.contaAtiva?.escola_id !== turma.rows[0].escola_id) {
      return res.status(403).json({ success: false, message: "A turma não pertence à escola ativa." });
    }
    const professor = await db.query(
      `SELECT f.id
       FROM funcionarios f
       JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
       WHERE f.id = $1 AND f.escola_id = $2 AND ae.status = 'ativo' AND pu.papel = 'professor'
       LIMIT 1`,
      [professor_id, turma.rows[0].escola_id]
    );
    if (professor.rowCount === 0) {
      return res.status(400).json({ success: false, message: "O professor selecionado não pertence a esta escola ou não está ativo." });
    }

    client = await db.connect();
    await client.query("BEGIN");

    await client.query(
      `UPDATE diretores_turma SET data_fim = CURRENT_DATE WHERE turma_id = $1 AND data_fim IS NULL`,
      [turmaId]
    );

    // Inserir o novo Diretor de Turma
    const resultado = await client.query(
      `INSERT INTO diretores_turma (turma_id, professor_id, data_inicio)
       VALUES ($1, $2, CURRENT_DATE)
       RETURNING *;`,
      [turmaId, professor_id]
    );
    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Diretor de turma atribuído com sucesso.",
      data: resultado.rows[0]
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => { });
    console.error("Erro ao definir diretor de turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao registar o diretor de turma." });
  } finally {
    client?.release();
  }
});


// ============================================================
// 3. ROTA: ATRIBUIR DISCIPLINAS E PROFESSORES À TURMA
// (Adapta-se a Jardim: 1 professor para tudo, ou Liceu: vários)
// ============================================================
router.post('/turmas/:turmaId/disciplinas', verificarAutenticacao, async (req, res) => {
  let client;
  try {
    const { turmaId } = req.params;
    const { disciplinas } = req.body || {};
    // 'disciplinas' é um array ex: [{ disciplina_id: 1, professor_id: "uuid...", carga_horaria: 4 }, ...]

    if (!UUID_PATTERN.test(turmaId) || !Array.isArray(disciplinas) || disciplinas.length === 0) {
      return res.status(400).json({
        success: false,
        message: "A turma e a lista de disciplinas são obrigatórias."
      });
    }

    const turma = await db.query(`SELECT escola_id FROM turmas WHERE id = $1 AND ativo = true`, [turmaId]);
    if (turma.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Turma não encontrada." });
    }
    const escolaId = turma.rows[0].escola_id;
    if (req.contaAtiva?.escola_id !== escolaId) {
      return res.status(403).json({ success: false, message: "A turma não pertence à escola ativa." });
    }
    for (const item of disciplinas) {
      const cargaHoraria = item?.carga_horaria === undefined || item.carga_horaria === ''
        ? 3
        : Number(item.carga_horaria);
      if (!UUID_PATTERN.test(item?.disciplina_id || '')
        || !UUID_PATTERN.test(item?.professor_id || '')
        || !Number.isInteger(cargaHoraria)
        || cargaHoraria < 1) {
        return res.status(400).json({ success: false, message: "Verifique disciplina, professor e carga horária informados." });
      }
    }

    client = await db.connect();
    await client.query("BEGIN");

    for (const item of disciplinas) {
      const professor = await client.query(
        `SELECT 1
         FROM funcionarios f
         JOIN associacoes_escola ae ON ae.utilizador_id = f.utilizador_id AND ae.escola_id = f.escola_id
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
         JOIN utilizadores u ON u.id = f.utilizador_id AND u.status_ativo = true
         WHERE f.id = $1 AND f.escola_id = $2 AND ae.status = 'ativo' AND pu.papel = 'professor'`,
        [item.professor_id, escolaId]
      );
      if (professor.rowCount === 0) {
        throw Object.assign(new Error("O professor selecionado não pertence a esta escola."), { statusCode: 400 });
      }
      const disciplina = await client.query(
        `SELECT 1 FROM disciplinas WHERE id = $1 AND ativa = true`,
        [item.disciplina_id]
      );
      if (disciplina.rowCount === 0) {
        throw Object.assign(new Error("A disciplina selecionada não existe ou está inativa."), { statusCode: 400 });
      }
      await client.query(`
        INSERT INTO turma_disciplinas (escola_id, turma_id, disciplina_id, professor_id, carga_horaria, ativo, atualizado_em)
        VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP)
        ON CONFLICT (escola_id, turma_id, disciplina_id) 
        DO UPDATE SET 
          professor_id = EXCLUDED.professor_id,
          carga_horaria = EXCLUDED.carga_horaria,
          ativo = true,
          atualizado_em = CURRENT_TIMESTAMP;
      `, [
        escolaId,
        turmaId,
        item.disciplina_id,
        item.professor_id,
        item.carga_horaria === undefined || item.carga_horaria === '' ? 3 : Number(item.carga_horaria)
      ]);
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Grade curricular e professores atribuídos com sucesso à turma."
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => { });
    console.error("Erro ao associar disciplinas à turma:", error);
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: "A disciplina ou o professor selecionado não pertence a esta escola." });
    }
    return res.status(500).json({ success: false, message: "Erro ao configurar as disciplinas da turma." });
  } finally {
    client?.release();
  }
});

router.delete('/turmas/disciplinas/:atribuicaoId', verificarAutenticacao, async (req, res) => {
  try {
    const { atribuicaoId } = req.params;
    const escolaId = req.contaAtiva?.escola_id;
    if (!UUID_PATTERN.test(atribuicaoId || '') || !UUID_PATTERN.test(escolaId || '')) {
      return res.status(400).json({ success: false, message: "Identificador da atribuição ou escola inválido." });
    }

    const resultado = await db.query(
      `UPDATE turma_disciplinas td
       SET ativo = false, atualizado_em = CURRENT_TIMESTAMP
       FROM turmas t
       WHERE td.id = $1 AND td.escola_id = $2
         AND td.turma_id = t.id AND t.escola_id = $2
         AND td.ativo = true
       RETURNING td.id`,
      [atribuicaoId, escolaId]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "A atribuição de disciplina ou professor já não existe nesta escola." });
    }
    return res.json({ success: true, message: "Professor retirado da disciplina. O histórico foi preservado." });
  } catch (error) {
    console.error("Erro ao retirar professor da turma:", error);
    return res.status(500).json({ success: false, message: "Não foi possível retirar o professor da turma." });
  }
});


// ============================================================
// 4. ROTA: OBTER DETALHES COMPLETOS DA TURMA (Para o Frontend)
// ============================================================
router.get('/turmas/:turmaId/completa', verificarAutenticacao, async (req, res) => {
  try {
    const { turmaId } = req.params;
    if (!UUID_PATTERN.test(turmaId)) {
      return res.status(400).json({ success: false, message: "Identificador da turma inválido." });
    }

    // 1. Dados da Turma
    const turmaRes = await db.query(`
      SELECT t.*, p.nome AS polo_nome, p.codigo AS polo_codigo,
             al.ano_nome AS ano_letivo
      FROM turmas t
      JOIN polos_escola p ON p.id = t.polo_id
      LEFT JOIN anos_letivos al ON al.id = t.ano_letivo_id
      WHERE t.id = $1 LIMIT 1;
    `, [turmaId]);

    if (turmaRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Turma não encontrada." });
    }
    if (req.contaAtiva?.escola_id !== turmaRes.rows[0].escola_id) {
      return res.status(403).json({ success: false, message: "A turma não pertence à escola ativa." });
    }

    // 2. Diretor de Turma Atual
    const diretorRes = await db.query(`
      SELECT dt.*, f.id AS professor_id, f.foto_url AS professor_foto,
             u.nome AS professor_nome, u.email AS professor_email,
             u.telefone AS professor_telefone
      FROM diretores_turma dt
      JOIN funcionarios f ON f.id = dt.professor_id
      JOIN utilizadores u ON u.id = f.utilizador_id
      WHERE dt.turma_id = $1 AND dt.data_fim IS NULL LIMIT 1;
    `, [turmaId]);

    // 3. Disciplinas e Professores da Turma
    const discRes = await db.query(`
      SELECT td.*, d.nome AS disciplina_nome, d.codigo AS disciplina_codigo,
             u.nome AS professor_nome, f.foto_url AS professor_foto
      FROM turma_disciplinas td
      JOIN disciplinas d ON d.id = td.disciplina_id
      LEFT JOIN funcionarios f ON f.id = td.professor_id
      LEFT JOIN utilizadores u ON u.id = f.utilizador_id
      WHERE td.turma_id = $1 AND td.ativo = true;
    `, [turmaId]);

    // 4. Alunos Inscritos na Turma
    const alunosRes = await db.query(`
      SELECT COALESCE(at.id, m.id) AS id, m.aluno_id, m.turma_id, m.ano_letivo_id,
             at.status AS status_turma, m.estado AS estado_matricula,
             at.numero_chamada, u.nome AS aluno_nome, u.login_id AS aluno_login,
             a.foto_url AS aluno_foto
      FROM matriculas m
      JOIN alunos a ON a.id = m.aluno_id
      JOIN utilizadores u ON u.id = a.utilizador_id
      LEFT JOIN alunos_turmas at
        ON at.aluno_id = m.aluno_id
       AND at.turma_id = m.turma_id
       AND at.ano_letivo_id = m.ano_letivo_id
       AND at.status IN ('ativo', 'promovido', 'transferido', 'retido')
      WHERE m.turma_id = $1 AND m.ano_letivo_id = $2
        AND m.estado IN ('ativa', 'pendente', 'concluida')
        AND (m.estado = 'pendente' OR at.aluno_id IS NOT NULL)
      ORDER BY at.numero_chamada ASC NULLS LAST, u.nome ASC;
    `, [turmaId, turmaRes.rows[0].ano_letivo_id]);

    return res.json({
      success: true,
      data: {
        turma: turmaRes.rows[0],
        diretor_turma: diretorRes.rows[0] || null,
        disciplinas: discRes.rows,
        alunos: alunosRes.rows
      }
    });

  } catch (error) {
    console.error("Erro ao buscar detalhes completos da turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar os dados da turma." });
  }
});

module.exports = router;