const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');
const { hashPassword } = require('../services/authService');
const { comprimirFotoPassaporteParaBase64 } = require('../services/imageService');
const { registarAuditoria } = require('../services/ownerAuditService');
const nodemailer = require('nodemailer');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uploadFotoAluno = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('A fotografia deve estar em formato JPG, PNG ou WEBP.'));
    }
    return callback(null, true);
  }
});
const uploadImportacaoAlunos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

const IMPORTACAO_COLUNAS = [
  { key: 'nome', label: 'Nome do aluno (obrigatório)' },
  { key: 'apelido', label: 'Apelido do aluno' },
  { key: 'email', label: 'Email do aluno (obrigatório)' },
  { key: 'telefone', label: 'Telefone do aluno (obrigatório)' },
  { key: 'genero', label: 'Género (Masculino/Feminino)' },
  { key: 'data_nascimento', label: 'Data de nascimento (AAAA-MM-DD)' },
  { key: 'numero_identificacao', label: 'BI ou documento do aluno' },
  { key: 'nacionalidade', label: 'Nacionalidade' },
  { key: 'regiao_origem', label: 'Região de origem' },
  { key: 'local_origem', label: 'Local de origem' },
  { key: 'regiao_morada', label: 'Região de morada' },
  { key: 'setor_morada', label: 'Setor de morada' },
  { key: 'endereco_morada', label: 'Endereço de morada' },
  { key: 'ultima_escola_frequentada', label: 'Última escola frequentada' },
  { key: 'ultima_nota', label: 'Última nota' },
  { key: 'foto_url', label: 'URL da fotografia (opcional)' },
  { key: 'numero_matricula', label: 'Número de matrícula (opcional)' },
  { key: 'observacoes', label: 'Observações da matrícula' },
  { key: 'encarregado_nome', label: 'Nome do encarregado (obrigatório)' },
  { key: 'encarregado_apelido', label: 'Apelido do encarregado' },
  { key: 'encarregado_telefone', label: 'Telefone do encarregado (obrigatório)' },
  { key: 'encarregado_email', label: 'Email do encarregado' },
  { key: 'parentesco', label: 'Parentesco (Pai/Mãe/Tio(a)/Tutor Legal)' },
  { key: 'contacto_principal', label: 'Contacto principal (true/false)' },
  { key: 'encarregado_occupacao', label: 'Ocupação do encarregado' },
  { key: 'encarregado_regiao_morada', label: 'Região de morada do encarregado' },
  { key: 'encarregado_setor_morada', label: 'Setor de morada do encarregado' },
  { key: 'encarregado_numero_identificacao', label: 'BI ou documento do encarregado' }
];
function receberFicheiroImportacao(req, res, next) {
  uploadImportacaoAlunos.single('ficheiro')(req, res, (error) => {
    if (!error) return next();
    const limite = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(limite ? 413 : 400).json({
      success: false,
      message: limite ? 'O ficheiro deve ter no máximo 10 MB.' : error.message || 'Não foi possível receber o ficheiro.'
    });
  });
}

function receberFotoAluno(req, res, next) {
  uploadFotoAluno.single('foto')(req, res, (error) => {
    if (!error) return next();
    const limite = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(limite ? 413 : 400).json({
      success: false,
      message: limite ? 'A fotografia deve ter no máximo 5 MB.' : error.message || 'Não foi possível receber a fotografia.'
    });
  });
}

function getEmailTransporter() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

function canAccessSchool(req, escolaId) {
  return req.user?.isOwner || req.contaAtiva?.escola_id === escolaId;
}

function canManageStudent(req, escolaId) {
  if (req.user?.isOwner === true) return true;
  if (!canAccessSchool(req, escolaId)) return false;
  const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
    .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    'direcao',
    'secretaria',
    'secretario',
    'secretaria escolar',
    'secretario escolar',
    'admin',
    'administrador'
  ].includes(papel);
}

function normalizarTelefoneGuineBissau(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const nationalNumber = digits.startsWith('00245')
    ? digits.slice(5)
    : digits.startsWith('245')
      ? digits.slice(3)
      : digits;
  return nationalNumber ? `+245 ${nationalNumber}` : '';
}

function telefoneGuineBissauValido(value) {
  return normalizarTelefoneGuineBissau(value).replace(/\D/g, '').replace(/^245/, '').length >= 7;
}

function obterIniciaisEscola(sigla) {
  const iniciais = String(sigla || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
  return iniciais.padEnd(2, 'X');
}

function obterCodigoPoloMatricula(polo, classe) {
  if (!polo) return 0;

  const identificacaoPolo = `${polo.codigo || ''} ${polo.nome || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const identificacao = `${identificacaoPolo} ${classe || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/jardim|infantil|maternal|pre.?escolar/.test(identificacao)) return 1;
  if (/superior|universidade|licenciatura/.test(identificacao)) return 7;
  if (/^(ram1)\b|basico.*1|1.*basico|primario|1.*ciclo/.test(identificacaoPolo)) return 2;
  if (/^(ram2)\b|basico.*2|2.*basico|2.*ciclo/.test(identificacaoPolo)) return 3;
  if (/^(ram3)\b|basico.*3|3.*basico|3.*ciclo/.test(identificacaoPolo)) return 4;
  if (/^(raml)\b|liceu|secundario/.test(identificacaoPolo)) return 5;
  if (/^(form)\b|formacao|tecnico|profissional/.test(identificacaoPolo)) return 6;

  const numeroClasse = Number(String(classe || '').match(/\b(1[0-2]|[1-9])\b/)?.[1]);
  if (numeroClasse >= 1 && numeroClasse <= 4) return 2;
  if (numeroClasse >= 5 && numeroClasse <= 6) return 3;
  if (numeroClasse >= 7 && numeroClasse <= 9) return 4;
  if (numeroClasse >= 10 && numeroClasse <= 12) return 5;
  return 7;
}

function obterNumeroClasse(classe) {
  const classeNormalizada = String(classe || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const numeroClasse = classeNormalizada.match(/(?:^|\D)(1[0-2]|[1-9])(?:\D|$)/)?.[1];
  if (numeroClasse) return Number(numeroClasse);

  const anoRomano = classeNormalizada.match(/\bano\s+(iii|ii|i)\b/)?.[1];
  return anoRomano ? { i: 1, ii: 2, iii: 3 }[anoRomano] : null;
}

function normalizarParentesco(value) {
  const parentesco = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const parentescos = {
    pai: 'Pai',
    mae: 'Mãe',
    tio: 'Tio(a)',
    tia: 'Tio(a)',
    'tio a': 'Tio(a)',
    'tia a': 'Tio(a)',
    'tio tia': 'Tio(a)',
    'tio ou tia': 'Tio(a)',
    'tutor legal': 'Tutor Legal'
  };
  return Object.hasOwn(parentescos, parentesco) ? parentescos[parentesco] : null;
}

async function obterOuCriarContaEncarregado(client, {
  escolaId,
  siglaEscola,
  nome,
  apelido,
  telefone,
  email,
  exigirConfirmacao = false,
  contaConfirmadaId = '',
  usarEmailComoLogin = false
}) {
  const procurarConta = () => client.query(
    `SELECT u.id, u.nome, u.telefone, u.email,
            COALESCE((
              SELECT ea.apelido
              FROM encarregado_alunos ea
              WHERE ea.utilizador_id = u.id
              ORDER BY ea.contacto_principal DESC, ea.id
              LIMIT 1
            ), '') AS apelido,
            EXISTS (
              SELECT 1
              FROM associacoes_escola ae
              JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
              WHERE ae.utilizador_id = u.id
                AND LOWER(TRIM(pu.papel)) = 'encarregado'
            ) AS e_encarregado
     FROM utilizadores u
     WHERE regexp_replace(COALESCE(u.telefone, ''), '[^0-9]', '', 'g') =
             regexp_replace($1, '[^0-9]', '', 'g')
        OR ($2 <> '' AND LOWER(COALESCE(u.email, '')) = $2)
     ORDER BY u.id
     FOR UPDATE OF u`,
    [telefone, email]
  );

  let contas = await procurarConta();
  if (contas.rowCount > 1) {
    if (exigirConfirmacao) {
      return {
        confirmationRequired: true,
        message: 'O telefone e o email informados pertencem a contas diferentes. Corrija um dos dados antes de continuar.',
        accounts: contas.rows
      };
    }
    return { error: 'O telemóvel e o email informados pertencem a contas diferentes. Confirme os dados do encarregado.' };
  }

  let conta = contas.rows[0] || null;
  if (conta && exigirConfirmacao && String(contaConfirmadaId) !== String(conta.id)) {
    return {
      confirmationRequired: true,
      message: 'Foi encontrada uma conta com este email ou telefone. Confirme se pretende associá-la ao aluno.',
      accounts: [conta]
    };
  }
  if (contaConfirmadaId && (!conta || String(contaConfirmadaId) !== String(conta.id))) {
    return { error: 'A conta confirmada já não corresponde ao email ou telefone informado. Verifique os dados do encarregado.' };
  }
  if (conta && !conta.e_encarregado
    && !(exigirConfirmacao && String(contaConfirmadaId) === String(conta.id))) {
    return { error: 'O telefone ou email do encarregado pertence a uma conta que não está registada como encarregado. Confirme os dados antes de matricular.' };
  }
  let utilizadorId = conta?.id;
  if (!utilizadorId) {
    if (usarEmailComoLogin && !email) {
      return { error: 'Informe o email do encarregado para criar a conta e permitir o acesso.' };
    }
    let loginId = email;
    if (!usarEmailComoLogin) {
      const total = await client.query(
        `SELECT COUNT(*) AS total
         FROM associacoes_escola ae
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
         WHERE ae.escola_id = $1 AND pu.papel = 'encarregado'`,
        [escolaId]
      );
      loginId = `ENC-${siglaEscola}-${String(Number(total.rows[0].total) + 1).padStart(3, '0')}`;
    }
    const senha = telefone.replace(/\D/g, '').slice(-7).padStart(7, '0');
    const senhaHash = await hashPassword(senha);
    const emailConta = email || `${loginId.toLowerCase()}@futurese.gw`;
    const criada = await client.query(
      `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta)
       VALUES ($1, $2, $3, $4, $5, true, 'normal')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [`${nome.trim()} ${apelido?.trim() || ''}`.trim(), emailConta, telefone, loginId, senhaHash]
    );

    utilizadorId = criada.rows[0]?.id;
    if (!utilizadorId) {
      contas = await procurarConta();
      if (contas.rowCount > 1) {
        if (exigirConfirmacao) {
          return {
            confirmationRequired: true,
            message: 'O telefone e o email informados pertencem a contas diferentes. Corrija um dos dados antes de continuar.',
            accounts: contas.rows
          };
        }
        return { error: 'O telemóvel e o email informados pertencem a contas diferentes. Confirme os dados do encarregado.' };
      }
      conta = contas.rows[0] || null;
      if (conta && exigirConfirmacao && String(contaConfirmadaId) !== String(conta.id)) {
        return {
          confirmationRequired: true,
          message: 'Foi encontrada uma conta com este email ou telefone. Confirme se pretende associá-la ao aluno.',
          accounts: [conta]
        };
      }
      if (contaConfirmadaId && (!conta || String(contaConfirmadaId) !== String(conta.id))) {
        return { error: 'A conta confirmada já não corresponde ao email ou telefone informado. Verifique os dados do encarregado.' };
      }
      if (conta && !conta.e_encarregado
        && !(exigirConfirmacao && String(contaConfirmadaId) === String(conta.id))) {
        return { error: 'O telefone ou email do encarregado pertence a uma conta que não está registada como encarregado. Confirme os dados antes de matricular.' };
      }
      utilizadorId = conta?.id;
      if (!utilizadorId) {
        return { error: 'Não foi possível criar a conta do encarregado porque o telefone ou email já pertence a outra conta.' };
      }
    } else {
      conta = { id: utilizadorId, telefone, email: emailConta, e_encarregado: true };
    }
  }

  const associacao = await client.query(
    `INSERT INTO associacoes_escola (escola_id, utilizador_id, status)
     VALUES ($1, $2, 'ativo')
     ON CONFLICT (escola_id, utilizador_id) DO UPDATE SET status = 'ativo'
     RETURNING id`,
    [escolaId, utilizadorId]
  );
  await client.query(
    `INSERT INTO papeis_utilizador (associacao_id, papel)
     VALUES ($1, 'encarregado')
     ON CONFLICT (associacao_id, papel) DO NOTHING`,
    [associacao.rows[0].id]
  );

  return {
    utilizadorId,
    telefone: conta?.telefone || telefone,
    email: conta?.email || email || null
  };
}

router.get('/importacao/escolas', verificarAutenticacao, async (req, res) => {
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: 'Apenas o Owner pode importar alunos para escolas.' });
  }
  try {
    const resultado = await db.query(
      `SELECT id, nome, sigla, local, sector, endereco, motto, visao, missao, valor, logo_url
       FROM escolas
       ORDER BY nome ASC`
    );
    return res.json({ success: true, data: resultado.rows });
  } catch (error) {
    console.error('Erro ao carregar escolas para importação de alunos:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as escolas.' });
  }
});

router.get('/:escolaId/importacao/opcoes', verificarAutenticacao, async (req, res) => {
  const { escolaId } = req.params;
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: 'Apenas o Owner pode importar alunos para escolas.' });
  }
  if (!UUID_PATTERN.test(escolaId)) {
    return res.status(400).json({ success: false, message: 'Identificador da escola inválido.' });
  }

  try {
    const [escola, anos, polos, turmas] = await Promise.all([
      db.query(
        `SELECT id, nome, sigla, local, sector, endereco, motto, visao, missao, valor, logo_url
         FROM escolas WHERE id = $1`,
        [escolaId]
      ),
      db.query(
        `SELECT eal.ano_letivo_id AS id, al.ano_nome, eal.ativo, eal.data_inicio, eal.data_fim
         FROM escola_anos_letivos eal
         JOIN anos_letivos al ON al.id = eal.ano_letivo_id
         WHERE eal.escola_id = $1
         ORDER BY eal.ativo DESC, eal.data_inicio DESC, al.ano_nome DESC`,
        [escolaId]
      ),
      db.query(
        `SELECT id, nome, codigo FROM polos_escola
         WHERE escola_id = $1 AND ativo = true
         ORDER BY nome ASC`,
        [escolaId]
      ),
      db.query(
        `SELECT t.id, t.nome, t.classe, t.turno, t.sala, t.ano_letivo_id, t.polo_id,
                p.nome AS polo_nome, al.ano_nome AS ano_letivo
         FROM turmas t
         JOIN polos_escola p ON p.id = t.polo_id AND p.escola_id = t.escola_id
         LEFT JOIN anos_letivos al ON al.id = t.ano_letivo_id
         WHERE t.escola_id = $1 AND t.ativo = true AND p.ativo = true
         ORDER BY al.ano_nome DESC, p.nome ASC, t.classe ASC, t.nome ASC`,
        [escolaId]
      )
    ]);

    if (!escola.rowCount) {
      return res.status(404).json({ success: false, message: 'Escola não encontrada.' });
    }

    return res.json({
      success: true,
      data: {
        escola: escola.rows[0],
        anos_letivos: anos.rows,
        polos: polos.rows,
        turmas: turmas.rows
      }
    });
  } catch (error) {
    console.error('Erro ao carregar opções da importação de alunos:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os dados de matrícula.' });
  }
});

router.get('/:escolaId/importacao/modelo', verificarAutenticacao, async (req, res) => {
  const { escolaId } = req.params;
  const { ano_letivo_id: anoLetivoId, polo_id: poloId, turma_id: turmaId } = req.query;
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: 'Apenas o Owner pode gerar modelos de importação.' });
  }
  if (!UUID_PATTERN.test(escolaId) || !UUID_PATTERN.test(anoLetivoId || '')
    || !UUID_PATTERN.test(poloId || '') || (turmaId && !UUID_PATTERN.test(turmaId))) {
    return res.status(400).json({ success: false, message: 'Selecione escola, ano letivo e polo válidos.' });
  }

  try {
    const contexto = await db.query(
      `SELECT e.nome AS escola_nome, e.sigla, e.local, e.sector, e.endereco, e.motto, e.visao, e.missao, e.valor,
              al.ano_nome, p.nome AS polo_nome, p.codigo AS polo_codigo,
              t.nome AS turma_nome, t.classe, t.turno, t.sala
       FROM escolas e
       JOIN escola_anos_letivos eal ON eal.escola_id = e.id AND eal.ano_letivo_id = $2
       JOIN anos_letivos al ON al.id = eal.ano_letivo_id
       JOIN polos_escola p ON p.escola_id = e.id AND p.id = $3 AND p.ativo = true
       LEFT JOIN LATERAL (
         SELECT turma.nome, turma.classe, turma.turno, turma.sala, turma.id
         FROM turmas turma
         WHERE turma.escola_id = e.id AND turma.ano_letivo_id = al.id
           AND turma.polo_id = p.id AND turma.ativo = true
           AND ($4::uuid IS NULL OR turma.id = $4)
         ORDER BY turma.classe ASC, turma.nome ASC
         LIMIT 1
       ) t ON true
       WHERE e.id = $1 AND ($4::uuid IS NULL OR t.id = $4)`,
      [escolaId, anoLetivoId, poloId, turmaId || null]
    );
    if (!contexto.rowCount) {
      return res.status(404).json({ success: false, message: 'A escola, o ano letivo ou o polo selecionado não foi encontrado.' });
    }

    const dados = contexto.rows[0];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIGE360';
    workbook.subject = 'Modelo de matrícula de alunos';
    workbook.title = `Matrículas — ${dados.escola_nome}`;
    const alunosSheet = workbook.addWorksheet('Alunos', {
      views: [{ state: 'frozen', ySplit: 5, showGridLines: false }]
    });
    const totalColunas = IMPORTACAO_COLUNAS.length;
    const ultimaColuna = alunosSheet.getColumn(totalColunas).letter;
    const nomeTurma = `${dados.classe || ''} ${dados.turma_nome || ''}`.trim() || 'A definir';

    alunosSheet.mergeCells(`A1:${ultimaColuna}1`);
    alunosSheet.getCell('A1').value = dados.escola_nome;
    alunosSheet.getRow(1).height = 48;
    alunosSheet.getRow(1).eachCell({ includeEmpty: true }, (celula) => {
      celula.font = { name: 'Arial', size: 22, bold: true, color: { argb: 'FF17324D' } };
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEFF5' } };
      celula.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    });

    alunosSheet.mergeCells(`A2:${ultimaColuna}2`);
    alunosSheet.getCell('A2').value = `LISTA DE MATRÍCULA DE ALUNOS — TURMA ${nomeTurma}`;
    alunosSheet.getCell('A2').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF17324D' } };
    alunosSheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
    alunosSheet.getRow(2).height = 28;

    alunosSheet.mergeCells(`A3:${ultimaColuna}3`);
    alunosSheet.getCell('A3').value = `Polo: ${dados.polo_nome}    |    Ano letivo: ${dados.ano_nome}    |    Turma: ${nomeTurma}${dados.turno ? `    |    Turno: ${dados.turno}` : ''}`;
    alunosSheet.getCell('A3').font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF334155' } };
    alunosSheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3F6' } };
    alunosSheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    alunosSheet.getRow(3).height = 25;

    alunosSheet.mergeCells(`A4:${ultimaColuna}4`);
    alunosSheet.getCell('A4').value = 'Preencha manualmente uma linha por aluno. O modelo não preenche valores nem limita o que pode escrever. Campos obrigatórios: nome, email e telefone do aluno; nome e telefone do encarregado. Use um email real e exclusivo. Data: AAAA-MM-DD.';
    alunosSheet.getCell('A4').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } };
    alunosSheet.getCell('A4').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    alunosSheet.getRow(4).height = 30;

    const linhaCabecalho = alunosSheet.getRow(5);
    linhaCabecalho.values = IMPORTACAO_COLUNAS.map((coluna) => coluna.label);
    linhaCabecalho.height = 44;
    linhaCabecalho.eachCell((celula) => {
      celula.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF102A36' } };
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9ECBD8' } };
      celula.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      celula.border = {
        top: { style: 'thin', color: { argb: 'FF526D78' } },
        left: { style: 'thin', color: { argb: 'FF526D78' } },
        bottom: { style: 'thin', color: { argb: 'FF526D78' } },
        right: { style: 'thin', color: { argb: 'FF526D78' } }
      };
    });
    IMPORTACAO_COLUNAS.forEach((coluna, index) => {
      alunosSheet.getColumn(index + 1).width = Math.min(Math.max(coluna.label.length + 3, 18), 34);
    });

    for (let numeroLinha = 6; numeroLinha <= 105; numeroLinha += 1) {
      const linha = alunosSheet.getRow(numeroLinha);
      linha.height = 22;
      for (let numeroColuna = 1; numeroColuna <= totalColunas; numeroColuna += 1) {
        const celula = linha.getCell(numeroColuna);
        celula.numFmt = '@';
        celula.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: numeroLinha % 2 === 0 ? 'FFFFFFFF' : 'FFF1F7F9' }
        };
        celula.border = {
          top: { style: 'thin', color: { argb: 'FFD0D8DC' } },
          left: { style: 'thin', color: { argb: 'FFD0D8DC' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D8DC' } },
          right: { style: 'thin', color: { argb: 'FFD0D8DC' } }
        };
      }
    }

    alunosSheet.autoFilter = { from: 'A5', to: `${ultimaColuna}105` };
    alunosSheet.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:5'
    };
    alunosSheet.headerFooter.oddFooter = '&LSIGE360&CLista de matrícula&R&P / &N';

    const instrucoesSheet = workbook.addWorksheet('Instruções', { views: [{ showGridLines: false }] });
    instrucoesSheet.columns = [{ width: 25 }, { width: 105 }];
    instrucoesSheet.addRow(['INSTRUÇÕES PARA PREENCHER']);
    instrucoesSheet.addRow(['Escola', dados.escola_nome]);
    instrucoesSheet.addRow(['Sigla', dados.sigla || '']);
    instrucoesSheet.addRow(['Localização', [dados.local, dados.sector, dados.endereco].filter(Boolean).join(' · ') || 'Não indicada']);
    instrucoesSheet.addRow(['Turma', nomeTurma]);
    instrucoesSheet.addRow(['Polo', dados.polo_nome]);
    instrucoesSheet.addRow(['Ano letivo', dados.ano_nome]);
    instrucoesSheet.addRow(['Campos obrigatórios', 'Nome, email e telefone do aluno; nome e telefone do encarregado.']);
    instrucoesSheet.addRow(['Data de nascimento', 'Use o formato AAAA-MM-DD.']);
    instrucoesSheet.addRow(['Telefone', 'Inclua o indicativo +245. Mantenha os telefones como texto para preservar zeros.']);
    instrucoesSheet.addRow(['Email', 'Use um endereço real e exclusivo por aluno. Exemplo: nome.apelido@gmail.com.']);
    instrucoesSheet.addRow(['Preenchimento', 'Todos os campos das linhas de alunos estão vazios e livres para escrever. Escolha os valores manualmente; o modelo não impõe listas suspensas.']);
    instrucoesSheet.addRow(['Fotografia', 'A URL da fotografia é opcional; também pode ser adicionada posteriormente.']);
    instrucoesSheet.addRow(['Lema', dados.motto || 'Não indicado']);
    instrucoesSheet.addRow(['Missão', dados.missao || 'Não indicada']);
    instrucoesSheet.addRow(['Visão', dados.visao || 'Não indicada']);
    instrucoesSheet.addRow(['Valores', dados.valor || 'Não indicados']);
    instrucoesSheet.addRow(['Talão e prazo', 'Esta importação do Owner dispensa talão e prazo de matrícula.']);
    instrucoesSheet.addRow(['Estado', 'As matrículas criadas pelo Owner ficam ativas imediatamente; a Direção recebe apenas uma notificação.']);
    instrucoesSheet.addRow(['Turma', dados.turma_nome ? nomeTurma : 'A definir; selecione/crie uma turma na página antes de gravar alunos.']);
    instrucoesSheet.addRow(['Limite', 'O ficheiro aceita até 500 alunos por importação. Não altere os títulos das colunas.']);
    instrucoesSheet.mergeCells('A1:B1');
    instrucoesSheet.getRow(1).height = 28;
    instrucoesSheet.getCell('A1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    instrucoesSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B87' } };
    instrucoesSheet.eachRow((linha, numeroLinha) => {
      if (numeroLinha > 1) {
        linha.getCell(1).font = { name: 'Arial', bold: true, color: { argb: 'FF17324D' } };
        linha.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }
    });

    const conteudo = await workbook.xlsx.writeBuffer();
    const nomeArquivo = `Modelo_Alunos_${String(dados.sigla || 'Escola').replace(/[^a-z0-9_-]/gi, '_')}_${String(dados.ano_nome).replace(/[^a-z0-9_-]/gi, '_')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    return res.send(conteudo);
  } catch (error) {
    console.error('Erro ao gerar modelo de importação de alunos:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível gerar o modelo Excel.' });
  }
});

router.post('/:escolaId/importacao/ficheiro', verificarAutenticacao, receberFicheiroImportacao, async (req, res) => {
  const { escolaId } = req.params;
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: 'Apenas o Owner pode validar ficheiros de importação.' });
  }
  if (!UUID_PATTERN.test(escolaId)) {
    return res.status(400).json({ success: false, message: 'Identificador da escola inválido.' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Selecione um ficheiro Excel ou CSV.' });
  }
  if (!/\.(xlsx|xls|csv)$/i.test(req.file.originalname || '')) {
    return res.status(400).json({ success: false, message: 'O ficheiro deve estar no formato XLSX, XLS ou CSV.' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const worksheet = workbook.Sheets.Alunos
      || (req.file.originalname.toLowerCase().endsWith('.csv')
        ? workbook.Sheets[workbook.SheetNames[0]]
        : null);
    if (!worksheet) {
      return res.status(400).json({ success: false, message: 'A folha "Alunos" não foi encontrada no ficheiro Excel.' });
    }
    const linhas = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false, blankrows: false });
    if (!linhas.length) {
      return res.status(400).json({ success: false, message: 'A folha "Alunos" não contém linhas para importar.' });
    }
    const labels = new Map(IMPORTACAO_COLUNAS.map((coluna) => [coluna.label, coluna.key]));
    const obrigatorias = ['nome', 'email', 'telefone', 'encarregado_nome', 'encarregado_telefone'];
    const indiceCabecalho = linhas.findIndex((linha) => {
      const cabecalhos = new Set(linha.map((valor) => String(valor ?? '').trim()));
      return obrigatorias.every((chave) => {
        const coluna = IMPORTACAO_COLUNAS.find((item) => item.key === chave);
        return cabecalhos.has(coluna.label);
      });
    });
    if (indiceCabecalho < 0) {
      return res.status(400).json({
        success: false,
        message: 'Não foi encontrada a linha de cabeçalhos da folha "Alunos". Utilize o modelo SIGE360 sem alterar os títulos das colunas.'
      });
    }

    const cabecalhos = linhas[indiceCabecalho].map((valor) => String(valor ?? '').trim());
    const faltantes = IMPORTACAO_COLUNAS
      .filter((coluna) => obrigatorias.includes(coluna.key) && !cabecalhos.includes(coluna.label))
      .map((coluna) => coluna.label);
    if (faltantes.length) {
      return res.status(400).json({
        success: false,
        message: `O ficheiro não contém as colunas obrigatórias: ${faltantes.join('; ')}. Utilize o modelo Excel SIGE360.`
      });
    }

    const alunos = linhas.slice(indiceCabecalho + 1)
      .map((linha) => Object.fromEntries(
        cabecalhos
          .map((label, indice) => {
            const chave = labels.get(label);
            const valor = String(linha[indice] ?? '').trim();
            return [chave, chave === 'parentesco' ? normalizarParentesco(valor) || valor : valor];
          })
          .filter(([chave, valor]) => chave && valor !== '')
      ))
      .filter((aluno) => ['nome', 'email', 'telefone', 'encarregado_nome', 'encarregado_telefone']
        .some((chave) => aluno[chave]));
    if (!alunos.length) {
      return res.status(400).json({ success: false, message: 'Não foram encontrados alunos preenchidos no ficheiro.' });
    }
    if (alunos.length > 500) {
      return res.status(400).json({ success: false, message: 'O ficheiro pode conter no máximo 500 alunos.' });
    }
    return res.json({ success: true, data: alunos, total: alunos.length });
  } catch (error) {
    console.error('Erro ao validar ficheiro de importação de alunos:', error);
    return res.status(400).json({ success: false, message: 'O ficheiro Excel/CSV é inválido ou está danificado.' });
  }
});

// ============================================================
// ROTA DE MATRÍCULA COM TRANSAÇÃO RIGOROSA (BEGIN / COMMIT / ROLLBACK)
// ============================================================
router.post('/:escolaId/alunos/registar', verificarAutenticacao, receberFotoAluno, async (req, res) => {
  let client;
  let transacaoIniciada = false;

  try {
    const { escolaId } = req.params;
    const {
      nome,
      apelido,
      email,
      telefone,
      genero,
      data_nascimento,
      numero_identificacao,
      nacionalidade,
      regiao_origem,
      local_origem,
      regiao_morada,
      setor_morada,
      endereco_morada,
      ultima_escola_frequentada,
      ultima_nota,
      encarregado_nome,
      encarregado_apelido,
      encarregado_telefone,
      encarregado_email,
      parentesco,
      contacto_principal,
      encarregado_occupacao,
      encarregado_regiao_morada,
      encarregado_setor_morada,
      encarregado_numero_identificacao
    } = req.body || {};
    const parentescoInformado = String(parentesco ?? '').trim();
    const parentescoNormalizado = normalizarParentesco(parentescoInformado);

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: 'Identificador da escola inválido.' });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Apenas o Owner, a Direção ou a Secretaria podem registar alunos.' });
    }

    if (
      typeof nome !== 'string' || !nome.trim() ||
      typeof apelido !== 'string' || !apelido.trim() ||
      typeof telefone !== 'string' || !telefoneGuineBissauValido(telefone) ||
      typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim()) ||
      typeof encarregado_nome !== 'string' || !encarregado_nome.trim() ||
      typeof encarregado_apelido !== 'string' || !encarregado_apelido.trim() ||
      typeof encarregado_telefone !== 'string' || !telefoneGuineBissauValido(encarregado_telefone) ||
      !req.file ||
      (encarregado_email && (typeof encarregado_email !== 'string' || !EMAIL_PATTERN.test(encarregado_email.trim()))) ||
      (genero && !['Masculino', 'Feminino'].includes(genero)) ||
      (parentescoInformado && !parentescoNormalizado)
    ) {
      return res.status(400).json({ success: false, message: 'Preencha os dados obrigatórios do aluno, a fotografia e os dados do encarregado.' });
    }
    if (data_nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(data_nascimento)) {
      return res.status(400).json({ success: false, message: 'A data de nascimento é inválida.' });
    }

    const fotoProcessada = await comprimirFotoPassaporteParaBase64(req.file.buffer);
    const telefoneAluno = normalizarTelefoneGuineBissau(telefone);
    const telefoneEncarregado = normalizarTelefoneGuineBissau(encarregado_telefone);
    const emailAluno = email.trim().toLowerCase();
    const emailEncarregado = typeof encarregado_email === 'string' ? encarregado_email.trim().toLowerCase() : '';
    let alunoIdEfetivo = aluno_id || null;

    client = await db.connect();
    await client.query('BEGIN');
    transacaoIniciada = true;

    const escolaRes = await client.query(
      'SELECT sigla FROM escolas WHERE id = $1 FOR UPDATE',
      [escolaId]
    );
    if (!escolaRes.rowCount) {
      return res.status(404).json({ success: false, message: 'Escola não encontrada.' });
    }

    if (!req.user?.isOwner) {
      const anoAberto = await client.query(
        `SELECT eal.ano_letivo_id
         FROM escola_anos_letivos eal
         JOIN prazos_matricula pm
           ON pm.escola_id = eal.escola_id
          AND pm.anos_letivo_id = eal.ano_letivo_id
         WHERE eal.escola_id = $1 AND eal.ativo = true
           AND pm.ativo = true
           AND CURRENT_DATE BETWEEN pm.data_inicio AND pm.data_fim
         ORDER BY pm.data_inicio DESC
         LIMIT 1
         FOR UPDATE OF eal, pm`,
        [escolaId]
      );
      if (!anoAberto.rowCount) {
        return res.status(423).json({ success: false, message: 'Matrículas fechadas: o período de registo não está em curso.' });
      }
    }

    if (numero_identificacao?.trim()) {
      const alunoDuplicado = await client.query(
        `SELECT 1
         FROM alunos a
         JOIN associacoes_escola ae ON ae.utilizador_id = a.utilizador_id
         WHERE ae.escola_id = $1 AND a.numero_identificacao = $2
         LIMIT 1`,
        [escolaId, numero_identificacao.trim()]
      );
      if (alunoDuplicado.rowCount) {
        return res.status(409).json({ success: false, message: 'Já existe um aluno registado com este número de identificação.' });
      }
    }
    const emailExistente = await client.query(
      'SELECT 1 FROM utilizadores WHERE LOWER(email) = $1 LIMIT 1',
      [emailAluno]
    );
    if (emailExistente.rowCount) {
      return res.status(409).json({ success: false, message: 'Este email já está registado. Cada aluno deve ter um email exclusivo.' });
    }

    const siglaEscola = String(escolaRes.rows[0].sigla || 'ESC').toUpperCase();
    const countAlunos = await client.query(
      `SELECT COUNT(*) AS total
       FROM associacoes_escola ae
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       WHERE ae.escola_id = $1 AND pu.papel = 'aluno'`,
      [escolaId]
    );
    const loginIdAluno = `ALU-${siglaEscola}-${String(Number(countAlunos.rows[0].total) + 1).padStart(3, '0')}`;
    const senhaTemporaria = telefoneAluno.replace(/\D/g, '').slice(-7).padStart(7, '0');
    const passwordAlunoHash = await hashPassword(senhaTemporaria);
    const userAluno = await client.query(
      `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta)
       VALUES ($1, $2, $3, $4, $5, true, 'normal')
       RETURNING id`,
      [nome.trim(), emailAluno, telefoneAluno, loginIdAluno, passwordAlunoHash]
    );
    const alunoUtilizadorId = userAluno.rows[0].id;
    const associacaoAluno = await client.query(
      `INSERT INTO associacoes_escola (escola_id, utilizador_id, status)
       VALUES ($1, $2, 'ativo')
       RETURNING id`,
      [escolaId, alunoUtilizadorId]
    );
    await client.query(
      `INSERT INTO papeis_utilizador (associacao_id, papel)
       VALUES ($1, 'aluno')`,
      [associacaoAluno.rows[0].id]
    );
    const alunoRes = await client.query(
      `INSERT INTO alunos (
         utilizador_id, apelido, data_nascimento, numero_identificacao, foto_url, genero,
         nacionalidade, regiao_origem, local_origem, regiao_morada, setor_morada,
         endereco_morada, ultima_escola_frequentada, ultima_nota
       )
       VALUES ($1, $2, NULLIF($3, '')::date, NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        alunoUtilizadorId,
        apelido.trim(),
        data_nascimento || '',
        numero_identificacao?.trim() || '',
        fotoProcessada,
        genero || 'Masculino',
        nacionalidade?.trim() || 'Guineense',
        regiao_origem?.trim() || '',
        local_origem?.trim() || '',
        regiao_morada?.trim() || '',
        setor_morada?.trim() || '',
        endereco_morada?.trim() || '',
        ultima_escola_frequentada?.trim() || '',
        ultima_nota?.trim() || ''
      ]
    );
    const alunoId = alunoRes.rows[0].id;

    const contaEncarregado = await obterOuCriarContaEncarregado(client, {
      escolaId,
      siglaEscola,
      nome: encarregado_nome,
      apelido: encarregado_apelido,
      telefone: telefoneEncarregado,
      email: emailEncarregado
    });
    if (contaEncarregado.error) {
      return res.status(409).json({ success: false, message: contaEncarregado.error });
    }
    const encarregadoUtilizadorId = contaEncarregado.utilizadorId;

    await client.query(
      `UPDATE encarregado_alunos
       SET contacto_principal = false
       WHERE aluno_id = $1 AND contacto_principal = true AND utilizador_id <> $2`,
      [alunoId, encarregadoUtilizadorId]
    );
    const relacaoExistente = await client.query(
      'SELECT id FROM encarregado_alunos WHERE aluno_id = $1 AND utilizador_id = $2 LIMIT 1',
      [alunoId, encarregadoUtilizadorId]
    );
    const dadosRelacao = [
      ![false, 'false'].includes(contacto_principal),
      parentescoNormalizado || 'Pai',
      encarregado_apelido.trim(),
      encarregado_occupacao?.trim() || null,
      encarregado_regiao_morada?.trim() || null,
      encarregado_setor_morada?.trim() || null,
      encarregado_numero_identificacao?.trim() || null
    ];
    if (relacaoExistente.rowCount) {
      await client.query(
        `UPDATE encarregado_alunos
         SET contacto_principal = $1, parentesco = $2, apelido = $3,
             occupacao = $4, regiao_morada = $5, setor_morada = $6,
             numero_identificacao = $7
         WHERE id = $8`,
        [...dadosRelacao, relacaoExistente.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO encarregado_alunos (
           aluno_id, utilizador_id, contacto_principal, parentesco,
           apelido, occupacao, regiao_morada, setor_morada, numero_identificacao
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [alunoId, encarregadoUtilizadorId, ...dadosRelacao]
      );
    }

    await client.query('COMMIT');
    transacaoIniciada = false;
    return res.status(201).json({
      success: true,
      message: 'Registo do aluno criado com sucesso.',
      data: {
        aluno_id: alunoId,
        login_id: loginIdAluno,
        senha_temporaria: senhaTemporaria
      }
    });
  } catch (error) {
    if (transacaoIniciada && client) {
      try {
        await client.query('ROLLBACK');
        transacaoIniciada = false;
      } catch (rollbackError) {
        console.error('Erro ao reverter registo do aluno:', rollbackError);
      }
    }
    console.error('Erro ao registar aluno:', error);
    if (error.code === '23505') {
      if (String(error.constraint || '').toLowerCase().includes('email')) {
        return res.status(409).json({ success: false, message: 'Este email já está registado. Cada aluno deve ter um email exclusivo.' });
      }
      if (String(error.constraint || '').toLowerCase().includes('telefone')) {
        return res.status(409).json({ success: false, message: 'Este telefone já está associado a outra conta. Confirme se pertence ao aluno ou ao encarregado.' });
      }
      if (String(error.constraint || '').toLowerCase().includes('identificacao')) {
        return res.status(409).json({ success: false, message: 'Este documento de identificação já está associado a outro aluno.' });
      }
      if (String(error.constraint || '').toLowerCase().includes('matricula')) {
        return res.status(409).json({ success: false, message: 'Este número de matrícula já está a ser utilizado por outro aluno.' });
      }
      return res.status(409).json({ success: false, message: 'Já existe um registo com este email, telefone ou número de identificação.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: 'Um dos dados selecionados já não existe. Atualize a página e tente novamente.' });
    }
    return res.status(500).json({ success: false, message: 'Não foi possível registar o aluno.' });
  } finally {
    if (transacaoIniciada && client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao reverter registo do aluno:', rollbackError);
      }
    }
    client?.release();
  }
});

router.post('/:escolaId/alunos/matricular', verificarAutenticacao, receberFotoAluno, async (req, res) => {
  let client;
  let transacaoIniciada = false;

  try {
    const { escolaId } = req.params;
    const ownerOverride = req.user?.isOwner === true;
    const {
      // Info dos Alunos
      aluno_id,
      nome,
      apelido,
      email,
      telefone,
      genero,                 // Dropdown ('Masculino', 'Feminino')
      data_nascimento,
      numero_identificacao,
      foto_url,
      nacionalidade,
      regiao_origem,          // Dropdown
      local_origem,           // Dropdown (setor de origem)
      regiao_morada,          // Dropdown
      setor_morada,           // Dropdown
      endereco_morada,
      ultima_escola_frequentada,
      ultima_nota,

      // Matrícula
      polo_id,                // Dropdown
      ano_letivo_id,          // Dropdown
      turma_id,               // Dropdown
      numero_matricula,
      observacoes,

      // Info do Encarregado
      encarregado_nome,
      encarregado_apelido,
      encarregado_telefone,
      encarregado_email,
      encarregado_conta_confirmada_id,
      parentesco,             // Dropdown ('Pai', 'Mãe', 'Tio(a)', 'Tutor Legal')
      contacto_principal,
      encarregado_occupacao,
      encarregado_regiao_morada, // Dropdown
      encarregado_setor_morada,  // Dropdown
      encarregado_numero_identificacao // Nº de ID / Bilhete
    } = req.body || {};
    const parentescoInformado = String(parentesco ?? '').trim();
    const parentescoNormalizado = normalizarParentesco(parentescoInformado);

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: "Apenas o Owner, a Direção ou a Secretaria podem efetuar matrículas." });
    }

    // Validações básicas e estruturais
    const camposInvalidos = [];
    if (aluno_id && !UUID_PATTERN.test(aluno_id)) camposInvalidos.push('identificador do aluno');
    if (typeof nome !== 'string' || !nome.trim()) camposInvalidos.push('nome do aluno');
    if (typeof telefone !== 'string' || !telefoneGuineBissauValido(telefone)) camposInvalidos.push('telefone do aluno');
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) camposInvalidos.push('email do aluno');
    if (!UUID_PATTERN.test(polo_id || '')) camposInvalidos.push('polo');
    if (!UUID_PATTERN.test(turma_id || '')) camposInvalidos.push('turma');
    if (!UUID_PATTERN.test(ano_letivo_id || '')) camposInvalidos.push('ano letivo');
    if (typeof encarregado_nome !== 'string' || !encarregado_nome.trim()) camposInvalidos.push('nome do encarregado');
    if (typeof encarregado_telefone !== 'string' || !telefoneGuineBissauValido(encarregado_telefone)) {
      camposInvalidos.push('telefone do encarregado');
    }
    if (typeof encarregado_email !== 'string' || !EMAIL_PATTERN.test(encarregado_email.trim())) {
      camposInvalidos.push('email do encarregado');
    }
    if (encarregado_conta_confirmada_id && !UUID_PATTERN.test(encarregado_conta_confirmada_id)) {
      camposInvalidos.push('conta confirmada do encarregado');
    }
    if (numero_identificacao && typeof numero_identificacao !== 'string') camposInvalidos.push('documento do aluno');
    if (numero_matricula && typeof numero_matricula !== 'string') camposInvalidos.push('número de matrícula');
    if (observacoes && typeof observacoes !== 'string') camposInvalidos.push('observações');
    if (foto_url && typeof foto_url !== 'string') camposInvalidos.push('fotografia');
    if (genero && !['Masculino', 'Feminino'].includes(genero)) camposInvalidos.push('género');
    if (parentescoInformado && !parentescoNormalizado) camposInvalidos.push('parentesco');
    if (camposInvalidos.length) {
      return res.status(400).json({
        success: false,
        message: `Dados inválidos ou em falta: ${camposInvalidos.join(', ')}.`
      });
    }

    if (data_nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(data_nascimento)) {
      return res.status(400).json({ success: false, message: "A data de nascimento é inválida." });
    }

    const telefoneAluno = normalizarTelefoneGuineBissau(telefone);
    const telefoneEncarregado = normalizarTelefoneGuineBissau(encarregado_telefone);
    const emailAluno = email.trim().toLowerCase();
    const emailEncarregado = typeof encarregado_email === 'string' ? encarregado_email.trim().toLowerCase() : '';
    let alunoIdEfetivo = aluno_id || null;

    client = await db.connect();
    await client.query("BEGIN");
    transacaoIniciada = true;

    // Verificar Escola
    const escolaRes = await client.query(`SELECT sigla FROM escolas WHERE id = $1 FOR UPDATE`, [escolaId]);
    if (escolaRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Escola não encontrada." });
    }
    const siglaEscola = String(escolaRes.rows[0].sigla || 'ESC').toUpperCase();

    // Validar Ano Letivo
    const anoRes = ownerOverride
      ? await client.query(
        `SELECT ano_letivo_id FROM escola_anos_letivos
         WHERE escola_id = $1 AND ano_letivo_id = $2
         FOR UPDATE`,
        [escolaId, ano_letivo_id]
      )
      : await client.query(
        `SELECT eal.ano_letivo_id
         FROM escola_anos_letivos eal
         JOIN prazos_matricula pm
           ON pm.escola_id = eal.escola_id
          AND pm.anos_letivo_id = eal.ano_letivo_id
         WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2
             AND pm.ativo = true
           AND CURRENT_DATE BETWEEN pm.data_inicio AND pm.data_fim
         FOR UPDATE OF eal, pm`,
        [escolaId, ano_letivo_id]
      );
    if (anoRes.rowCount === 0) {
      return res.status(423).json({ success: false, message: "Matrículas fechadas: o período de matrícula não está em curso." });
    }

    // The enrollment class must belong to the selected polo.
    const turmaRes = await client.query(
      `SELECT t.id, t.polo_id, t.classe,
              p.codigo AS polo_codigo, p.nome AS polo_nome
       FROM turmas t
       JOIN polos_escola p ON p.id = t.polo_id AND p.escola_id = t.escola_id 
       WHERE t.id = $1 AND t.escola_id = $2
         AND t.ano_letivo_id = $3 AND t.ativo = true AND p.ativo = true
       FOR UPDATE OF t`,
      [turma_id, escolaId, ano_letivo_id]
    );
    if (turmaRes.rowCount === 0) {
      return res.status(400).json({ success: false, message: "A turma selecionada não pertence a esta escola ou ano letivo, ou está inativa." });
    }
    if (turmaRes.rows[0].polo_id !== polo_id) {
      return res.status(409).json({
        success: false,
        message: 'A turma selecionada deve pertencer ao ramo escolhido para a matrícula.'
      });
    }

    const fotoProcessada = req.file
      ? await comprimirFotoPassaporteParaBase64(req.file.buffer)
      : (foto_url ? await comprimirFotoPassaporteParaBase64(foto_url) : null);

    if (!alunoIdEfetivo && ownerOverride) {
      const alunoComMesmoEmail = await client.query(
        `SELECT a.id AS aluno_id
         FROM utilizadores u
         JOIN alunos a ON a.utilizador_id = u.id
         JOIN associacoes_escola ae
           ON ae.utilizador_id = u.id AND ae.escola_id = $2
         JOIN papeis_utilizador pu
           ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'aluno'
         WHERE LOWER(u.email) = $1
         ORDER BY a.id
         LIMIT 2
         FOR UPDATE OF u, a`,
        [emailAluno, escolaId]
      );
      if (alunoComMesmoEmail.rowCount > 1) {
        return res.status(409).json({
          success: false,
          message: 'Este email está associado a mais de uma conta de aluno nesta escola. Corrija os registos antes de matricular.'
        });
      }
      if (alunoComMesmoEmail.rowCount === 1) {
        alunoIdEfetivo = alunoComMesmoEmail.rows[0].aluno_id;
      }
    }

    const contaEncarregado = await obterOuCriarContaEncarregado(client, {
      escolaId,
      siglaEscola,
      nome: encarregado_nome,
      apelido: encarregado_apelido,
      telefone: telefoneEncarregado,
      email: emailEncarregado,
      exigirConfirmacao: true,
      contaConfirmadaId: encarregado_conta_confirmada_id,
      usarEmailComoLogin: true
    });
    if (contaEncarregado.confirmationRequired) {
      return res.status(409).json({
        success: false,
        confirmationRequired: true,
        message: contaEncarregado.message,
        accounts: contaEncarregado.accounts.map((conta) => ({
          id: conta.id,
          nome: conta.nome,
          apelido: conta.apelido,
          telefone: conta.telefone,
          email: conta.email,
          e_encarregado: conta.e_encarregado
        }))
      });
    }
    if (contaEncarregado.error) {
      return res.status(409).json({ success: false, message: contaEncarregado.error });
    }
    const encarregadoUtilizadorId = contaEncarregado.utilizadorId;
    let telefoneAlunoFinal = telefoneAluno;
    let emailAlunoFinal = emailAluno;

    let alunoId;
    let alunoUtilizadorId;
    let loginIdAluno;
    let senhaAlunoTemp = null;

    if (alunoIdEfetivo) {
      const alunoExistente = await client.query(
        `SELECT a.id, a.utilizador_id, u.login_id
         FROM alunos a
         JOIN utilizadores u ON u.id = a.utilizador_id
         JOIN associacoes_escola ae ON ae.utilizador_id = u.id AND ae.escola_id = $2
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'aluno'
         WHERE a.id = $1
         FOR UPDATE OF a, u`,
        [alunoIdEfetivo, escolaId]
      );
      if (alunoExistente.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Aluno não encontrado nesta escola." });
      }

      alunoId = alunoExistente.rows[0].id;
      alunoUtilizadorId = alunoExistente.rows[0].utilizador_id;
      loginIdAluno = alunoExistente.rows[0].login_id;

      const conflitosContactoAluno = await client.query(
        `SELECT id, telefone, email
         FROM utilizadores
         WHERE (telefone = $1 OR LOWER(email) = $2) AND id <> $3
         FOR UPDATE`,
        [telefoneAluno, emailAluno, alunoUtilizadorId]
      );
      for (const conta of conflitosContactoAluno.rows) {
        if (conta.id !== encarregadoUtilizadorId) {
          if (conta.telefone === telefoneAluno) {
            return res.status(409).json({
              success: false,
              message: 'O telefone informado para o aluno já pertence a outra conta, diferente do encarregado selecionado. Confirme o telefone do aluno.'
            });
          }
          return res.status(409).json({
            success: false,
            message: 'O email informado para o aluno já pertence a outra conta. Informe um email exclusivo para o aluno.'
          });
        }
        if (conta.telefone === telefoneAluno) telefoneAlunoFinal = null;
        if (String(conta.email || '').toLowerCase() === emailAluno) emailAlunoFinal = null;
      }

      await client.query(
        `UPDATE utilizadores
         SET nome = $1, email = $2, telefone = $3,
             status_ativo = true, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [nome.trim(), emailAlunoFinal, telefoneAlunoFinal, alunoUtilizadorId]
      );
      await client.query(
        `UPDATE alunos SET apelido = NULLIF($1, ''), data_nascimento = NULLIF($2, '')::date,
           numero_identificacao = NULLIF($3, ''), foto_url = COALESCE($4, foto_url),
           genero = $5, nacionalidade = NULLIF($6, ''), regiao_origem = NULLIF($7, ''),
           local_origem = NULLIF($8, ''), regiao_morada = NULLIF($9, ''),
           setor_morada = NULLIF($10, ''), endereco_morada = NULLIF($11, ''),
           ultima_escola_frequentada = NULLIF($12, ''), ultima_nota = NULLIF($13, ''),
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = $14`,
        [
          apelido?.trim() || '', data_nascimento || '', numero_identificacao?.trim() || '',
          fotoProcessada, genero || 'Masculino', nacionalidade?.trim() || '',
          regiao_origem?.trim() || '', local_origem?.trim() || '', regiao_morada?.trim() || '',
          setor_morada?.trim() || '', endereco_morada?.trim() || '',
          ultima_escola_frequentada?.trim() || '', ultima_nota?.trim() || '', alunoId
        ]
      );
      const associacaoAluno = await client.query(
        `UPDATE associacoes_escola SET status = 'ativo'
         WHERE escola_id = $1 AND utilizador_id = $2 RETURNING id`,
        [escolaId, alunoUtilizadorId]
      );
      if (associacaoAluno.rowCount === 0) {
        return res.status(404).json({ success: false, message: "A associação do aluno à escola não foi encontrada." });
      }
    } else {
      // Criar Utilizador do Aluno
      const codigoNivel = obterCodigoPoloMatricula(
        { codigo: turmaRes.rows[0].polo_codigo, nome: turmaRes.rows[0].polo_nome },
        turmaRes.rows[0].classe
      );
      const numeroClasse = obterNumeroClasse(turmaRes.rows[0].classe);
      if (!numeroClasse || numeroClasse > 12) {
        return res.status(400).json({
          success: false,
          message: 'Não foi possível gerar o ID do aluno porque a classe ou etapa da turma não tem um número válido entre 1 e 12.'
        });
      }
      const prefixoLoginAluno = `${String(new Date().getFullYear()).slice(-2)}${obterIniciaisEscola(siglaEscola)}${codigoNivel}${String(numeroClasse).padStart(2, '0')}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [prefixoLoginAluno]);
      const serialAluno = await client.query(
        `SELECT COALESCE(MAX(substring(u.login_id FROM $1)::bigint), 0) + 1 AS serial
         FROM utilizadores u
         WHERE u.login_id ~ $1`,
        [`^${prefixoLoginAluno}([0-9]+)$`]
      );
      loginIdAluno = `${prefixoLoginAluno}${String(serialAluno.rows[0].serial).padStart(3, '0')}`;
      senhaAlunoTemp = telefone.replace(/\D/g, '').slice(-7).padStart(7, '0');
      const senhaAlunoHash = await hashPassword(senhaAlunoTemp);
      const conflitosContactoAluno = await client.query(
        `SELECT id, telefone, email
         FROM utilizadores
         WHERE telefone = $1 OR LOWER(email) = $2
         FOR UPDATE`,
        [telefoneAluno, emailAluno]
      );
      for (const conta of conflitosContactoAluno.rows) {
        if (conta.id !== encarregadoUtilizadorId) {
          if (conta.telefone === telefoneAluno) {
            return res.status(409).json({
              success: false,
              message: 'O telefone informado para o aluno já pertence a outra conta, diferente do encarregado selecionado. Confirme o telefone do aluno.'
            });
          }
          return res.status(409).json({
            success: false,
            message: 'O email informado para o aluno já pertence a outra conta. Informe um email exclusivo para o aluno.'
          });
        }
        if (conta.telefone === telefoneAluno) telefoneAlunoFinal = null;
        if (String(conta.email || '').toLowerCase() === emailAluno) emailAlunoFinal = null;
      }

      const userAlunoRes = await client.query(
        `INSERT INTO utilizadores (nome, email, telefone, login_id, password_hash, status_ativo, tipo_conta) 
         VALUES ($1, $2, $3, $4, $5, true, 'normal') RETURNING id`,
        [nome.trim(), emailAlunoFinal, telefoneAlunoFinal, loginIdAluno, senhaAlunoHash]
      );
      alunoUtilizadorId = userAlunoRes.rows[0].id;

      const assocAluno = await client.query(
        `INSERT INTO associacoes_escola (escola_id, utilizador_id, status) VALUES ($1, $2, 'ativo') RETURNING id`,
        [escolaId, alunoUtilizadorId]
      );
      await client.query(`INSERT INTO papeis_utilizador (associacao_id, papel) VALUES ($1, 'aluno')`, [assocAluno.rows[0].id]);

      const alunoRes = await client.query(
        `INSERT INTO Alunos (
           utilizador_id, apelido, data_nascimento, numero_identificacao, foto_url, genero, 
           nacionalidade, regiao_origem, local_origem, regiao_morada, setor_morada, 
           endereco_morada, ultima_escola_frequentada, ultima_nota
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          alunoUtilizadorId, apelido || null, data_nascimento || null, numero_identificacao || null,
          fotoProcessada, genero || 'Masculino', nacionalidade || 'Guineense', regiao_origem || null,
          local_origem || null, regiao_morada || null, setor_morada || null, endereco_morada || null,
          ultima_escola_frequentada || null, ultima_nota || null
        ]
      );
      alunoId = alunoRes.rows[0].id;
    }

    // Ligar Encarregado ao Aluno (incluindo apelido, ocupação e dados adicionais do encarregado)
    if (encarregadoUtilizadorId) {
      await client.query(
        `UPDATE encarregado_alunos SET contacto_principal = false
         WHERE aluno_id = $1 AND contacto_principal = true AND utilizador_id <> $2`,
        [alunoId, encarregadoUtilizadorId]
      );
      const guardianRelation = await client.query(
        `SELECT id FROM encarregado_alunos WHERE aluno_id = $1 AND utilizador_id = $2 LIMIT 1`,
        [alunoId, encarregadoUtilizadorId]
      );
      const guardianValues = [
        ![false, 'false'].includes(contacto_principal), parentescoNormalizado || 'Pai', encarregado_apelido || null,
        encarregado_occupacao || null, encarregado_regiao_morada || null,
        encarregado_setor_morada || null, encarregado_numero_identificacao || null
      ];
      if (guardianRelation.rowCount) {
        await client.query(
          `UPDATE encarregado_alunos SET contacto_principal = $1, parentesco = $2,
             apelido = $3, occupacao = $4, regiao_morada = $5, setor_morada = $6,
             numero_identificacao = $7 WHERE id = $8`,
          [...guardianValues, guardianRelation.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO encarregado_alunos (
             aluno_id, utilizador_id, contacto_principal, parentesco,
             apelido, occupacao, regiao_morada, setor_morada, numero_identificacao
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [alunoId, encarregadoUtilizadorId, ...guardianValues]
        );
      }
    }

    // Criar Matrícula
    const numMatriculaFinal = numero_matricula?.trim() || `MAT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const matriculaExistente = await client.query(
      `SELECT 1 FROM matriculas
       WHERE escola_id = $1 AND aluno_id = $2 AND ano_letivo_id = $3
         AND estado IN ('ativa', 'pendente')
       LIMIT 1`,
      [escolaId, alunoId, ano_letivo_id]
    );
    if (matriculaExistente.rowCount) {
      return res.status(409).json({ success: false, message: "Este aluno já tem uma matrícula ativa neste ano letivo." });
    }
    const matriculaRes = await client.query(
      `INSERT INTO Matriculas (escola_id, polo_id, aluno_id, ano_letivo_id, turma_id, data_matricula, numero_matricula, observacoes, estado) 
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8)
       RETURNING id`,
      [
        escolaId, turmaRes.rows[0].polo_id, alunoId, ano_letivo_id, turma_id,
        numMatriculaFinal, observacoes || null, ownerOverride ? 'ativa' : 'pendente'
      ]
    );

    if (ownerOverride) {
      await client.query(
        `INSERT INTO alunos_turmas (aluno_id, turma_id, ano_letivo_id, status)
         VALUES ($1, $2, $3, 'ativo')
         ON CONFLICT DO NOTHING`,
        [alunoId, turma_id, ano_letivo_id]
      );

      const direcao = await client.query(
        `SELECT COALESCE(array_agg(DISTINCT ae.utilizador_id), '{}'::uuid[]) AS destinatarios
         FROM associacoes_escola ae
         JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
         JOIN utilizadores u ON u.id = ae.utilizador_id
         WHERE ae.escola_id = $1 AND ae.status = 'ativo' AND u.status_ativo = true
           AND LOWER(TRIM(pu.papel)) = 'direcao'`,
        [escolaId]
      );
      await client.query(
        `INSERT INTO platform_notifications
           (escola_id, categoria, titulo, mensagem, autor_id, destinatarios, recipient_user_ids)
         VALUES ($1, 'matricula', $2, $3, $4, ARRAY['direcao']::text[], $5::uuid[])`,
        [
          escolaId,
          'Matrícula criada pelo Owner',
          `O Owner criou a matrícula de ${nome.trim()} (${numMatriculaFinal}). O aluno já está ativo; não é necessária aprovação.`,
          req.user.id,
          direcao.rows[0].destinatarios
        ]
      );
    }

    await client.query("COMMIT");
    transacaoIniciada = false;
    if (ownerOverride) {
      await registarAuditoria({
        actorId: req.user.id,
        escolaId,
        acao: 'matricula_owner_ativa_sem_prazo',
        entidade: 'matricula',
        entidadeId: matriculaRes.rows[0].id,
        detalhes: { aluno_id: alunoId, turma_id, ano_letivo_id },
        ipAddress: req.ip || req.socket?.remoteAddress || null
      });
    }

    return res.status(201).json({
      success: true,
      message: ownerOverride
        ? 'Matrícula criada sem validação do prazo. O aluno já está ativo e a Direção foi notificada.'
        : "Registo enviado à Direção para decisão final.",
      data: {
        aluno_id: alunoId,
        matricula_id: matriculaRes.rows[0].id,
        polo_id: turmaRes.rows[0].polo_id,
        login_id: loginIdAluno,
        senha_temporaria: senhaAlunoTemp,
        numero_matricula: numMatriculaFinal,
        estado: ownerOverride ? 'ativa' : 'pendente',
        owner_override: ownerOverride,
        conta_reutilizada: Boolean(alunoIdEfetivo)
      }
    });

  } catch (error) {
    if (transacaoIniciada && client) {
      try {
        await client.query("ROLLBACK");
        transacaoIniciada = false;
      } catch (rollbackError) {
        console.error("Erro ao reverter matrícula:", rollbackError);
      }
    }
    console.error("Erro na transação de matrícula:", error);
    if (error.code === '23505') {
      if (String(error.constraint || '').toLowerCase().includes('email')) {
        return res.status(409).json({ success: false, message: 'Este email já está registado. Cada aluno deve ter um email exclusivo.' });
      }
      if (String(error.constraint || '').toLowerCase().includes('telefone')) {
        return res.status(409).json({ success: false, message: 'Este telefone já está associado a outra conta. Confirme se pertence ao aluno ou ao encarregado.' });
      }
      if (String(error.constraint || '').toLowerCase().includes('identificacao')) {
        return res.status(409).json({ success: false, message: 'Este documento de identificação já está associado a outro aluno.' });
      }
      if (String(error.constraint || '').toLowerCase().includes('matricula')) {
        return res.status(409).json({ success: false, message: 'Este número de matrícula já está a ser utilizado por outro aluno.' });
      }
      return res.status(409).json({ success: false, message: "Já existe um registo com este documento ou número de matrícula." });
    }
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: "Um dos dados selecionados já não existe. Atualize a página e tente novamente." });
    }
    return res.status(500).json({ success: false, message: "Erro crítico ao efetuar a matrícula." });
  } finally {
    if (transacaoIniciada && client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Erro ao reverter matrícula:", rollbackError);
      }
    }
    client?.release();
  }
});

// ============================================================
// 2. ROTA: EDITAR DADOS DO ALUNO E ENCARREGADO
// (Para Owner, Secretaria, Direção ou Administrador)
// ============================================================
router.put('/:alunoId', verificarAutenticacao, receberFotoAluno, async (req, res) => {
  let client;
  try {
    const { alunoId } = req.params;
    const body = req.body || {};
    const {
      nome,
      email,
      telefone,
      genero,
      apelido,
      numero_identificacao,
      data_nascimento,
      nacionalidade,
      regiao_origem,
      local_origem,
      regiao_morada,
      setor_morada,
      endereco_morada,
      ultima_escola_frequentada,
      ultima_nota,
      status_ativo,
      encarregados: encarregadosJson
    } = body;
    const campoEnviado = (campo) => Object.prototype.hasOwnProperty.call(body, campo);

    if (!UUID_PATTERN.test(alunoId)) {
      return res.status(400).json({ success: false, message: "Identificador do aluno inválido." });
    }
    const escolaId = req.user?.isOwner
      ? body.escola_id || null
      : req.contaAtiva?.escola_id || null;
    if (req.user?.isOwner && !UUID_PATTERN.test(escolaId || '')) {
      return res.status(400).json({ success: false, message: "Selecione uma escola válida para editar o aluno." });
    }
    if ((!req.user?.isOwner && !escolaId) || (escolaId && !canManageStudent(req, escolaId))) {
      return res.status(403).json({ success: false, message: "Apenas o Owner, a Direção ou a Secretaria podem editar alunos." });
    }
    if (email && !EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Informe um email válido." });
    }
    if (campoEnviado('nome') && (typeof nome !== 'string' || !nome.trim())) {
      return res.status(400).json({ success: false, message: "O nome do aluno não pode ficar vazio." });
    }
    if (campoEnviado('telefone') && telefone && !telefoneGuineBissauValido(telefone)) {
      return res.status(400).json({ success: false, message: "Informe um telemóvel válido da Guiné-Bissau." });
    }
    if (campoEnviado('data_nascimento') && data_nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(data_nascimento)) {
      return res.status(400).json({ success: false, message: "A data de nascimento é inválida." });
    }
    if (genero && !['Masculino', 'Feminino', 'Outro'].includes(genero)) {
      return res.status(400).json({ success: false, message: "Género inválido." });
    }
    if (status_ativo !== undefined
      && ![true, false, 'true', 'false'].includes(status_ativo)) {
      return res.status(400).json({ success: false, message: "Estado da conta inválido." });
    }
    let encarregados = [];
    if (encarregadosJson) {
      try {
        encarregados = JSON.parse(encarregadosJson);
      } catch {
        return res.status(400).json({ success: false, message: "Dados dos encarregados inválidos." });
      }
      if (!Array.isArray(encarregados) || encarregados.some((encarregado) =>
        !UUID_PATTERN.test(encarregado?.id || '')
        || (encarregado.email && !EMAIL_PATTERN.test(encarregado.email))
      )) {
        return res.status(400).json({ success: false, message: "Dados dos encarregados inválidos." });
      }
    }

    client = await db.connect();
    await client.query("BEGIN");

    // Buscar utilizador_id associado a este aluno
    const alunoRes = await client.query(
      `SELECT a.utilizador_id FROM alunos a
       WHERE a.id = $1
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM associacoes_escola ae
           WHERE ae.utilizador_id = a.utilizador_id AND ae.escola_id = $2
         ))
       FOR UPDATE OF a`,
      [alunoId, escolaId]
    );
    if (alunoRes.rowCount === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const utilizadorId = alunoRes.rows[0].utilizador_id;
    if (req.user?.isOwner) {
      const notasRes = await client.query(
        `SELECT EXISTS (
           SELECT 1
           FROM notas_trimestrais nt
           JOIN matriculas m ON m.id = nt.matricula_id AND m.escola_id = nt.escola_id
           WHERE m.aluno_id = $1 AND nt.escola_id = $2
         ) AS tem_notas`,
        [alunoId, escolaId]
      );
      if (notasRes.rows[0].tem_notas) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(409).json({
          success: false,
          message: "Não é possível editar este aluno porque já tem notas registadas nesta escola."
        });
      }
    }
    const fotoComprimida = req.file
      ? await comprimirFotoPassaporteParaBase64(req.file.buffer)
      : null;

    // 1. Atualizar Tabela Utilizadores
    await client.query(
      `UPDATE utilizadores SET
        nome = CASE WHEN $1::boolean THEN $2 ELSE nome END,
        email = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE email END,
        telefone = CASE WHEN $5::boolean THEN NULLIF($6, '') ELSE telefone END,
        status_ativo = CASE WHEN $7::boolean THEN $8::boolean ELSE status_ativo END,
        atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [
        campoEnviado('nome'), nome?.trim() || '',
        campoEnviado('email'), email?.trim() || '',
        campoEnviado('telefone'), telefone?.trim() ? normalizarTelefoneGuineBissau(telefone) : '',
        campoEnviado('status_ativo'), status_ativo === true || status_ativo === 'true',
        utilizadorId
      ]
    );

    // 2. Atualizar Tabela Alunos
    await client.query(
      `UPDATE alunos SET
        apelido = CASE WHEN $1::boolean THEN NULLIF($2, '') ELSE apelido END,
        numero_identificacao = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE numero_identificacao END,
        foto_url = COALESCE($5, foto_url),
        genero = CASE WHEN $6::boolean THEN NULLIF($7, '') ELSE genero END,
        endereco_morada = CASE WHEN $8::boolean THEN NULLIF($9, '') ELSE endereco_morada END,
        data_nascimento = CASE WHEN $10::boolean THEN NULLIF($11, '')::date ELSE data_nascimento END,
        nacionalidade = CASE WHEN $12::boolean THEN NULLIF($13, '') ELSE nacionalidade END,
        regiao_origem = CASE WHEN $14::boolean THEN NULLIF($15, '') ELSE regiao_origem END,
        local_origem = CASE WHEN $16::boolean THEN NULLIF($17, '') ELSE local_origem END,
        regiao_morada = CASE WHEN $18::boolean THEN NULLIF($19, '') ELSE regiao_morada END,
        setor_morada = CASE WHEN $20::boolean THEN NULLIF($21, '') ELSE setor_morada END,
        ultima_escola_frequentada = CASE WHEN $22::boolean THEN NULLIF($23, '') ELSE ultima_escola_frequentada END,
        ultima_nota = CASE WHEN $24::boolean THEN NULLIF($25, '') ELSE ultima_nota END,
        atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $26`,
      [
        campoEnviado('apelido'), apelido?.trim() || '',
        campoEnviado('numero_identificacao'), numero_identificacao?.trim() || '',
        fotoComprimida,
        campoEnviado('genero'), genero || '',
        campoEnviado('endereco_morada'), endereco_morada?.trim() || '',
        campoEnviado('data_nascimento'), data_nascimento || '',
        campoEnviado('nacionalidade'), nacionalidade?.trim() || '',
        campoEnviado('regiao_origem'), regiao_origem?.trim() || '',
        campoEnviado('local_origem'), local_origem?.trim() || '',
        campoEnviado('regiao_morada'), regiao_morada?.trim() || '',
        campoEnviado('setor_morada'), setor_morada?.trim() || '',
        campoEnviado('ultima_escola_frequentada'), ultima_escola_frequentada?.trim() || '',
        campoEnviado('ultima_nota'), ultima_nota?.trim() || '',
        alunoId
      ]
    );

    for (const encarregado of encarregados) {
      const resultado = await client.query(
        `UPDATE encarregado_alunos ea
         SET parentesco = NULLIF($1, ''), apelido = NULLIF($2, ''),
             occupacao = NULLIF($3, ''), regiao_morada = NULLIF($4, ''),
             setor_morada = NULLIF($5, ''), numero_identificacao = NULLIF($6, ''),
             contacto_principal = CASE WHEN $7::boolean THEN $8::boolean ELSE ea.contacto_principal END
         FROM utilizadores u
         WHERE ea.id = $9 AND ea.aluno_id = $10 AND u.id = ea.utilizador_id
           AND ($11::uuid IS NULL OR EXISTS (
             SELECT 1 FROM associacoes_escola ae
             WHERE ae.utilizador_id = u.id AND ae.escola_id = $11
           ))
         RETURNING u.id AS utilizador_id`,
        [
          encarregado.parentesco?.trim() || '', encarregado.apelido?.trim() || '',
          encarregado.occupacao?.trim() || '', encarregado.regiao_morada?.trim() || '',
          encarregado.setor_morada?.trim() || '', encarregado.numero_identificacao?.trim() || '',
          Object.prototype.hasOwnProperty.call(encarregado, 'contacto_principal'),
          encarregado.contacto_principal === true || encarregado.contacto_principal === 'true',
          encarregado.id, alunoId, escolaId
        ]
      );
      if (resultado.rowCount !== 1) {
        throw new Error('Um dos encarregados já não está associado a este aluno.');
      }
      await client.query(
        `UPDATE utilizadores SET nome = $1, email = NULLIF($2, ''),
           telefone = NULLIF($3, ''), atualizado_em = CURRENT_TIMESTAMP WHERE id = $4`,
        [
          encarregado.nome?.trim() || '', encarregado.email?.trim() || '',
          encarregado.telefone?.trim() || '', resultado.rows[0].utilizador_id
        ]
      );
    }

    await client.query("COMMIT");
    client.release();

    return res.json({
      success: true,
      message: "Dados do aluno atualizados com sucesso."
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    console.error("Erro ao atualizar aluno:", error);
    const conflitoEncarregado = error.message === 'Um dos encarregados já não está associado a este aluno.';
    return res.status(conflitoEncarregado ? 409 : 500).json({
      success: false,
      message: conflitoEncarregado ? error.message : "Erro ao atualizar dados do aluno."
    });
  }
});

router.post('/:escolaId/encarregados/:encarregadoId/senha', verificarAutenticacao, async (req, res) => {
  const { escolaId, encarregadoId } = req.params;
  const novaSenha = req.body?.nova_senha;
  if (!UUID_PATTERN.test(escolaId || '') || !UUID_PATTERN.test(encarregadoId || '')) {
    return res.status(400).json({ success: false, message: 'Escola ou encarregado inválido.' });
  }
  if (!canManageStudent(req, escolaId)) {
    return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem redefinir a senha de encarregados desta escola.' });
  }
  if (typeof novaSenha !== 'string' || novaSenha.length < 6 || novaSenha.length > 128) {
    return res.status(400).json({ success: false, message: 'A nova senha deve ter entre 6 e 128 caracteres.' });
  }

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const encarregado = await client.query(
      `SELECT u.id
       FROM utilizadores u
       JOIN associacoes_escola ae
         ON ae.utilizador_id = u.id
        AND ae.escola_id = $2
        AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id
        AND LOWER(TRIM(pu.papel)) = 'encarregado'
       WHERE u.id = $1
         AND u.tipo_conta <> 'owner'
         AND EXISTS (
           SELECT 1
           FROM encarregado_alunos ea
           JOIN alunos a ON a.id = ea.aluno_id
           JOIN associacoes_escola associacao_aluno
             ON associacao_aluno.utilizador_id = a.utilizador_id
            AND associacao_aluno.escola_id = $2
            AND associacao_aluno.status = 'ativo'
           JOIN papeis_utilizador papel_aluno
             ON papel_aluno.associacao_id = associacao_aluno.id
            AND LOWER(TRIM(papel_aluno.papel)) = 'aluno'
           WHERE ea.utilizador_id = u.id
         )
       FOR UPDATE OF u`,
      [encarregadoId, escolaId]
    );
    if (!encarregado.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Encarregado não encontrado nesta escola.' });
    }

    const passwordHash = await hashPassword(novaSenha);
    await client.query(
      `UPDATE utilizadores
       SET password_hash = $1, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, encarregadoId]
    );
    await client.query(
      `UPDATE sessoes SET revogado = true
       WHERE utilizador_id = $1 AND revogado IS NOT TRUE`,
      [encarregadoId]
    );
    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Senha do encarregado alterada. Todas as sessões abertas foram terminadas.'
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('Erro ao reverter redefinição de senha do encarregado:', rollbackError);
      });
    }
    console.error('Erro ao redefinir senha de encarregado:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível alterar a senha do encarregado.' });
  } finally {
    client?.release();
  }
});


// ============================================================
// 3. ROTA: GET ALUNO ESPECÍFICO (Ficha Completa do Aluno)
// ============================================================
router.get('/:alunoId', verificarAutenticacao, async (req, res) => {
  try {
    const { alunoId } = req.params;

    const query = `
      SELECT 
        a.id AS aluno_id,
        u.id AS utilizador_id,
        u.nome,
        u.email,
        u.telefone,
        u.login_id,
        u.genero,
        u.morada,
        u.bi_ou_passaporte,
        u.foto_base64,
        u.status_ativo,
        a.data_nascimento,
        a.naturalidade,
        a.nacionalidade,
        a.parentesco_encarregado,
        -- Turma Atual
        t.id AS turma_id,
        t.nome AS turma_nome,
        t.turno AS turma_turno,
        t.sala AS turma_sala,
        al.ano_nome,
        at.numero_chamada,
        at.status AS status_matricula,
        -- Dados do Encarregado
        e.id AS encarregado_id,
        ue.nome AS encarregado_nome,
        ue.email AS encarregado_email,
        ue.telefone AS encarregado_telefone,
        e.profissao AS encarregado_profissao
      FROM alunos a
      JOIN utilizadores u ON u.id = a.utilizador_id
      LEFT JOIN alunos_turmas at ON at.aluno_id = a.id AND at.status = 'ativo'
      LEFT JOIN turmas t ON t.id = at.turma_id
      LEFT JOIN anos_letivos al ON al.id = at.ano_letivo_id
      LEFT JOIN encarregados e ON e.id = a.encarregado_id
      LEFT JOIN utilizadores ue ON ue.id = e.utilizador_id
      WHERE a.id = $1 LIMIT 1;
    `;

    const resultado = await db.query(query, [alunoId]);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }

    return res.json({
      success: true,
      data: resultado.rows[0]
    });

  } catch (error) {
    console.error("Erro ao carregar aluno:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar a ficha do aluno." });
  }
});


// ============================================================
// 4. ROTA: GET TODOS OS ALUNOS DE UMA ESCOLA (Com Filtros e Pesquisa)
// ============================================================
router.get('/:escolaId/alunos', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { turma_id, ano_letivo_id, polo_id, search, situacao_turma } = req.query;
    const incluirSemMatricula = req.user?.isOwner === true && req.query.incluir_sem_matricula === 'true';
    const somenteAlunos = req.user?.isOwner === true && req.query.somente_alunos === 'true';

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!canAccessSchool(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    if ((polo_id && !UUID_PATTERN.test(polo_id))
      || (ano_letivo_id && !UUID_PATTERN.test(ano_letivo_id))
      || (turma_id && !UUID_PATTERN.test(turma_id))) {
      return res.status(400).json({ success: false, message: "Polo, turma ou ano letivo inválido." });
    }
    if (situacao_turma && !['com_turma', 'sem_turma'].includes(situacao_turma)) {
      return res.status(400).json({ success: false, message: "A situação de turma selecionada é inválida." });
    }
    if (search !== undefined && (typeof search !== 'string' || search.trim().length > 100)) {
      return res.status(400).json({ success: false, message: "A pesquisa deve ter até 100 caracteres." });
    }

    let query = `
      SELECT
        a.id AS aluno_id,
        a.apelido,
        a.regiao_morada,
        a.setor_morada,
        a.genero,
        a.foto_url,
        EXISTS (
          SELECT 1
          FROM notas_trimestrais nt
          JOIN matriculas nota_matricula
            ON nota_matricula.id = nt.matricula_id
           AND nota_matricula.escola_id = nt.escola_id
          WHERE nota_matricula.aluno_id = a.id
            AND nt.escola_id = $1
        ) AS tem_notas,
        u.id AS utilizador_id,
        u.nome,
        u.email,
        u.telefone,
        u.login_id,
        u.status_ativo,
        m.polo_id,
        m.numero_matricula,
        m.estado AS estado_matricula,
        t.id AS turma_id,
        t.nome AS turma_nome,
        at.numero_chamada,
        encarregado.nome AS encarregado_nome,
        encarregado.apelido AS encarregado_apelido,
        encarregado.email AS encarregado_email,
        encarregado.telefone AS encarregado_telefone
      FROM alunos a
      JOIN utilizadores u ON u.id = a.utilizador_id
      JOIN associacoes_escola ae
        ON ae.utilizador_id = a.utilizador_id
        AND ae.escola_id = $1
        AND ae.status = 'ativo'
      JOIN papeis_utilizador pu
        ON pu.associacao_id = ae.id
        AND LOWER(TRIM(pu.papel)) = 'aluno'
      LEFT JOIN LATERAL (
        SELECT m.aluno_id, m.polo_id, m.numero_matricula, m.turma_id, m.estado,
               COALESCE(m.ano_letivo_id, mt.ano_letivo_id) AS ano_letivo_id
        FROM matriculas m
        LEFT JOIN turmas mt ON mt.id = m.turma_id AND mt.escola_id = m.escola_id
        WHERE m.aluno_id = a.id
          AND m.escola_id = $1
          AND (
            m.estado IN ('ativa', 'pendente')
            OR ($2::uuid IS NOT NULL AND m.estado = 'concluida')
          )
          AND ($2::uuid IS NULL OR COALESCE(m.ano_letivo_id, mt.ano_letivo_id) = $2)
        ORDER BY CASE m.estado WHEN 'ativa' THEN 0 ELSE 1 END,
                 m.data_matricula DESC NULLS LAST, m.criado_em DESC
        LIMIT 1
      ) m ON true
      LEFT JOIN alunos_turmas at
        ON at.aluno_id = a.id
        AND at.turma_id = m.turma_id
        AND at.ano_letivo_id = m.ano_letivo_id
        AND at.status IN ('ativo', 'promovido', 'transferido', 'retido')
      LEFT JOIN polos_escola p ON p.id = m.polo_id AND p.escola_id = $1
      LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = $1
      LEFT JOIN LATERAL (
        SELECT ea.apelido, ue.nome, ue.email, ue.telefone
        FROM encarregado_alunos ea
        JOIN utilizadores ue ON ue.id = ea.utilizador_id
        WHERE ea.aluno_id = a.id
        ORDER BY ea.contacto_principal DESC, ea.criado_em DESC
        LIMIT 1
      ) encarregado ON true
      WHERE (
        $2::uuid IS NULL
        OR m.aluno_id IS NOT NULL
        OR $3::boolean
        OR EXISTS (
          SELECT 1
          FROM prazos_matricula pm
          WHERE pm.escola_id = $1
            AND pm.anos_letivo_id = $2
            AND u.criado_em >= pm.data_inicio::timestamp
            AND u.criado_em < (pm.data_fim + 1)::timestamp
        )
      )
    `;

    const params = [escolaId, ano_letivo_id || null, incluirSemMatricula];
    let paramIdx = 4;

    if (turma_id) {
      const turmaParam = paramIdx;
      params.push(turma_id);
      paramIdx++;
      query += ` AND EXISTS (
        SELECT 1
        FROM matriculas turma_aluno
        LEFT JOIN turmas turma_letivo
          ON turma_letivo.id = turma_aluno.turma_id
         AND turma_letivo.escola_id = turma_aluno.escola_id
        WHERE turma_aluno.aluno_id = a.id
          AND turma_aluno.escola_id = $1
          AND turma_aluno.turma_id = $${turmaParam}
          AND (
            turma_aluno.estado IN ('ativa', 'pendente')
            OR ($2::uuid IS NOT NULL AND turma_aluno.estado = 'concluida')
          )
          AND ($2::uuid IS NULL OR COALESCE(turma_aluno.ano_letivo_id, turma_letivo.ano_letivo_id) = $2)
      )
      AND m.turma_id = $${turmaParam}`;
    }

    if (situacao_turma === 'com_turma') {
      query += ' AND m.turma_id IS NOT NULL';
    } else if (situacao_turma === 'sem_turma') {
      query += ' AND m.turma_id IS NULL';
    }

    if (polo_id) {
      query += situacao_turma === 'sem_turma'
        ? ` AND ((m.polo_id = $${paramIdx} AND p.ativo = true) OR m.aluno_id IS NULL)`
        : ` AND m.polo_id = $${paramIdx} AND p.ativo = true`;
      params.push(polo_id);
      paramIdx++;
    }

    if (search?.trim()) {
      query += ` AND (
      u.nome ILIKE $${paramIdx}
      OR COALESCE(a.apelido, '') ILIKE $${paramIdx}
      OR CONCAT_WS(' ', u.nome, a.apelido) ILIKE $${paramIdx}
      OR u.login_id ILIKE $${paramIdx}
      OR COALESCE(u.telefone, '') ILIKE $${paramIdx}
      OR COALESCE(encarregado.nome, '') ILIKE $${paramIdx}
      OR COALESCE(encarregado.apelido, '') ILIKE $${paramIdx}
      OR COALESCE(encarregado.telefone, '') ILIKE $${paramIdx}
      )`;
      params.push(`%${String(search).trim()}%`);
      paramIdx++;
    }

    query += ` ORDER BY u.nome ASC;`;

    const resultado = await db.query(query, params);
    let alunos = resultado.rows;

    if (situacao_turma === 'sem_turma' && !somenteAlunos) {
      const candidatosPagamento = await db.query(
        `SELECT tp.id, tp.nome_candidato AS nome, NULL::text AS apelido,
                tp.codigo_talao AS login_id, tp.polo_id, p.nome AS polo_nome,
                tp.estado AS estado_pagamento, 'candidato_pagamento' AS tipo_registo_lista,
                true AS status_ativo
         FROM tesouraria_pagamentos tp
         LEFT JOIN polos_escola p ON p.id = tp.polo_id AND p.escola_id = tp.escola_id
         WHERE tp.escola_id = $1
           AND ($2::uuid IS NULL OR tp.ano_letivo_id = $2)
           AND tp.tipo_registo = 'candidato_novo'
           AND tp.estado IN ('pendente_aprovacao', 'aprovado')
           AND tp.codigo_talao IS NOT NULL
           AND tp.aluno_id IS NULL
           AND tp.matricula_id IS NULL
         ORDER BY tp.criado_em DESC`,
        [escolaId, ano_letivo_id || null]
      );
      alunos = [...alunos, ...candidatosPagamento.rows];
    }

    return res.json({
      success: true,
      total: alunos.length,
      data: alunos
    });

  } catch (error) {
    console.error("Erro ao listar alunos:", error);
    return res.status(500).json({ success: false, message: "Erro ao listar alunos da escola." });
  }
});

router.get('/:escolaId/alunos/pesquisar', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const termo = String(req.query.termo || '').trim();
    if (!UUID_PATTERN.test(escolaId) || termo.length < 2 || termo.length > 100) {
      return res.status(400).json({ success: false, message: 'Informe pelo menos dois caracteres para pesquisar.' });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem pesquisar alunos.' });
    }

    const resultado = await db.query(
      `SELECT DISTINCT a.id AS aluno_id, a.apelido, a.numero_identificacao, a.foto_url,
              u.nome, u.telefone, u.email, u.login_id, u.status_ativo,
              ultima_matricula.numero_matricula, ultima_matricula.ano_nome,
              ultima_matricula.estado AS estado_matricula
       FROM alunos a
       JOIN utilizadores u ON u.id = a.utilizador_id
       JOIN associacoes_escola ae ON ae.utilizador_id = u.id AND ae.escola_id = $1
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       LEFT JOIN LATERAL (
         SELECT m.numero_matricula, m.estado, al.ano_nome
         FROM matriculas m
         LEFT JOIN anos_letivos al ON al.id = m.ano_letivo_id
         WHERE m.aluno_id = a.id AND m.escola_id = $1
         ORDER BY m.data_matricula DESC NULLS LAST
         LIMIT 1
       ) ultima_matricula ON true
       WHERE LOWER(TRIM(pu.papel)) = 'aluno'
         AND (
           u.nome ILIKE $2 OR COALESCE(a.apelido, '') ILIKE $2
           OR CONCAT_WS(' ', u.nome, a.apelido) ILIKE $2
           OR COALESCE(u.login_id, '') ILIKE $2
           OR COALESCE(u.telefone, '') ILIKE $2
           OR COALESCE(u.email, '') ILIKE $2
           OR COALESCE(a.numero_identificacao, '') ILIKE $2
           OR COALESCE(ultima_matricula.numero_matricula, '') ILIKE $2
         )
       ORDER BY u.nome ASC
       LIMIT 25`,
      [escolaId, `%${termo}%`]
    );
    return res.json({ success: true, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao pesquisar alunos para matrícula:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível pesquisar os alunos.' });
  }
});

router.get('/:escolaId/alunos/:alunoId/ficha', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId, alunoId } = req.params;
    const anoLetivoId = req.query.ano_letivo_id || null;
    if (!UUID_PATTERN.test(escolaId) || !UUID_PATTERN.test(alunoId)
      || (anoLetivoId && !UUID_PATTERN.test(anoLetivoId))) {
      return res.status(400).json({ success: false, message: 'Escola, aluno ou ano letivo inválido.' });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem consultar a ficha completa do aluno.' });
    }

    const baseResult = await db.query(
      `SELECT to_jsonb(a) AS aluno,
              jsonb_build_object(
                'id', u.id, 'nome', u.nome, 'email', u.email, 'telefone', u.telefone,
                'login_id', u.login_id, 'status_ativo', u.status_ativo,
                'tipo_conta', u.tipo_conta, 'criado_em', u.criado_em, 'atualizado_em', u.atualizado_em
              ) AS utilizador,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', ae.id, 'escola_id', ae.escola_id, 'escola_nome', e.nome,
                  'escola_sigla', e.sigla, 'status', ae.status, 'criado_em', ae.criado_em,
                  'papeis', COALESCE((
                    SELECT jsonb_agg(pu.papel ORDER BY pu.papel)
                    FROM papeis_utilizador pu WHERE pu.associacao_id = ae.id
                  ), '[]'::jsonb)
                ) ORDER BY ae.criado_em DESC)
                FROM associacoes_escola ae
                JOIN escolas e ON e.id = ae.escola_id
                WHERE ae.utilizador_id = u.id AND ae.escola_id = $2
              ), '[]'::jsonb) AS associacoes
       FROM alunos a
       JOIN utilizadores u ON u.id = a.utilizador_id
       WHERE a.id = $1 AND EXISTS (
         SELECT 1 FROM associacoes_escola ae
         WHERE ae.utilizador_id = u.id AND ae.escola_id = $2
       )
         AND ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM escola_anos_letivos eal
           WHERE eal.escola_id = $2 AND eal.ano_letivo_id = $3
         ))`,
      [alunoId, escolaId, anoLetivoId]
    );
    if (baseResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Aluno ou ano letivo não encontrado nesta escola.' });
    }

    const [guardiansResult, enrollmentsResult, classLinksResult] = await Promise.all([
      db.query(
        `SELECT ea.id, ea.parentesco, ea.contacto_principal, ea.apelido,
                ea.occupacao, ea.regiao_morada, ea.setor_morada, ea.numero_identificacao,
                ea.criado_em,
                jsonb_build_object(
                  'id', u.id, 'nome', u.nome, 'email', u.email, 'telefone', u.telefone,
                  'login_id', u.login_id, 'status_ativo', u.status_ativo, 'tipo_conta', u.tipo_conta
                ) AS utilizador,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'associacao_id', ae.id, 'status', ae.status, 'papel', pu.papel
                  ) ORDER BY ae.criado_em DESC)
                  FROM associacoes_escola ae
                  JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
                  WHERE ae.utilizador_id = u.id AND ae.escola_id = $2
                ), '[]'::jsonb) AS associacoes
         FROM encarregado_alunos ea
         JOIN utilizadores u ON u.id = ea.utilizador_id
         WHERE ea.aluno_id = $1
         ORDER BY ea.contacto_principal DESC, u.nome ASC`,
        [alunoId, escolaId]
      ),
      db.query(
        `SELECT m.id, m.numero_matricula, m.data_matricula, m.estado, m.observacoes,
                m.ano_letivo_id, al.ano_nome,
                jsonb_build_object('id', p.id, 'nome', p.nome, 'codigo', p.codigo,
                  'local', p.local, 'endereco', p.endereco, 'telefone', p.telefone, 'ativo', p.ativo) AS polo,
                jsonb_build_object('id', t.id, 'nome', t.nome, 'classe', t.classe,
                  'turno', t.turno, 'sala', t.sala, 'ativo', t.ativo) AS turma,
                at.numero_chamada, at.status AS status_aluno_turma,
                COALESCE(oferta.disciplinas, '[]'::jsonb) AS cursos_oferecidos
         FROM matriculas m
         LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
         LEFT JOIN anos_letivos al ON al.id = COALESCE(m.ano_letivo_id, t.ano_letivo_id)
         LEFT JOIN polos_escola p ON p.id = m.polo_id AND p.escola_id = m.escola_id
         LEFT JOIN alunos_turmas at
           ON at.aluno_id = m.aluno_id AND at.turma_id = m.turma_id
          AND at.ano_letivo_id = COALESCE(m.ano_letivo_id, t.ano_letivo_id)
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', d.id, 'nome', d.nome, 'codigo', d.codigo,
             'descricao', d.descricao, 'carga_horaria', td.carga_horaria,
             'ativo', td.ativo, 'professor_id', td.professor_id, 'professor_nome', professor.nome
           ) ORDER BY d.nome) AS disciplinas
           FROM turma_disciplinas td
           JOIN disciplinas d ON d.id = td.disciplina_id
           LEFT JOIN funcionarios f ON f.id = td.professor_id AND f.escola_id = td.escola_id
           LEFT JOIN utilizadores professor ON professor.id = f.utilizador_id
           WHERE td.turma_id = t.id AND td.escola_id = m.escola_id
         ) oferta ON true
         WHERE m.aluno_id = $1 AND m.escola_id = $2
           AND ($3::uuid IS NULL OR COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $3)
         ORDER BY al.ano_nome DESC NULLS LAST, m.data_matricula DESC`,
        [alunoId, escolaId, anoLetivoId]
      ),
      db.query(
        `SELECT at.id, at.ano_letivo_id, al.ano_nome, at.numero_chamada, at.status,
                jsonb_build_object('id', t.id, 'nome', t.nome, 'classe', t.classe,
                  'turno', t.turno, 'sala', t.sala) AS turma
         FROM alunos_turmas at
         JOIN turmas t ON t.id = at.turma_id AND t.escola_id = $2
         JOIN anos_letivos al ON al.id = at.ano_letivo_id
         WHERE at.aluno_id = $1
           AND ($3::uuid IS NULL OR at.ano_letivo_id = $3)
         ORDER BY al.ano_nome DESC, t.nome ASC`,
        [alunoId, escolaId, anoLetivoId]
      )
    ]);

    return res.json({
      success: true,
      data: {
        ...baseResult.rows[0],
        encarregados: guardiansResult.rows,
        matriculas: enrollmentsResult.rows,
        alunos_turmas: classLinksResult.rows
      }
    });
  } catch (error) {
    console.error('Erro ao carregar ficha completa do aluno:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a ficha completa do aluno.' });
  }
});

router.post('/:escolaId/alunos/mudar-turma', verificarAutenticacao, async (req, res) => {
  const { escolaId } = req.params;
  const { aluno_ids: alunoIds, ano_letivo_id: anoLetivoId, turma_id: turmaId } = req.body || {};
  if (!req.user?.isOwner) {
    return res.status(403).json({ success: false, message: 'Apenas o Owner pode mudar alunos de turma por esta operação.' });
  }
  if (!UUID_PATTERN.test(escolaId || '') || !UUID_PATTERN.test(anoLetivoId || '')
    || !UUID_PATTERN.test(turmaId || '') || !Array.isArray(alunoIds)
    || alunoIds.length < 1 || alunoIds.length > 500
    || alunoIds.some((id) => !UUID_PATTERN.test(id || ''))
    || new Set(alunoIds).size !== alunoIds.length) {
    return res.status(400).json({
      success: false,
      message: 'Selecione uma escola, um ano, uma turma e entre 1 e 500 alunos válidos.'
    });
  }

  let client;
  let transacaoIniciada = false;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    transacaoIniciada = true;

    const turmaDestino = await client.query(
      `SELECT t.id, t.polo_id
       FROM turmas t
       JOIN polos_escola p ON p.id = t.polo_id AND p.escola_id = t.escola_id
       JOIN escola_anos_letivos eal
         ON eal.escola_id = t.escola_id AND eal.ano_letivo_id = t.ano_letivo_id
       WHERE t.id = $1 AND t.escola_id = $2 AND t.ano_letivo_id = $3
         AND t.ativo = true AND p.ativo = true
       FOR UPDATE OF t`,
      [turmaId, escolaId, anoLetivoId]
    );
    if (!turmaDestino.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(400).json({
        success: false,
        message: 'A turma de destino não está ativa nesta escola e neste ano letivo.'
      });
    }

    const alunosRes = await client.query(
      `SELECT a.id
       FROM alunos a
       JOIN associacoes_escola ae
         ON ae.utilizador_id = a.utilizador_id
        AND ae.escola_id = $2 AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'aluno'
       WHERE a.id = ANY($1::uuid[])
       ORDER BY a.id
       FOR UPDATE OF a`,
      [alunoIds, escolaId]
    );
    if (alunosRes.rowCount !== alunoIds.length) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(404).json({
        success: false,
        message: 'Um ou mais alunos já não estão associados a esta escola. Atualize a lista e tente novamente.'
      });
    }

    const matriculasRes = await client.query(
      `SELECT m.id, m.aluno_id, m.estado,
              EXISTS (
                SELECT 1 FROM notas_trimestrais nt
                WHERE nt.matricula_id = m.id AND nt.escola_id = m.escola_id
              ) AS tem_notas,
              EXISTS (
                SELECT 1 FROM presencas p
                WHERE p.matricula_id = m.id AND p.escola_id = m.escola_id
              ) AS tem_presencas
       FROM matriculas m
       WHERE m.escola_id = $1 AND m.ano_letivo_id = $2
         AND m.aluno_id = ANY($3::uuid[])
       ORDER BY m.aluno_id
       FOR UPDATE`,
      [escolaId, anoLetivoId, alunoIds]
    );
    const matriculasPorAluno = new Map(matriculasRes.rows.map((matricula) => [matricula.aluno_id, matricula]));
    const matriculasIncompativeis = matriculasRes.rows.filter((matricula) => (
      !['ativa', 'pendente', 'anulada'].includes(matricula.estado)
    ));
    if (matriculasIncompativeis.length) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(409).json({
        success: false,
        message: 'Um ou mais alunos têm uma matrícula transferida ou concluída neste ano. Não foi feita nenhuma alteração.'
      });
    }
    if (matriculasRes.rows.some((matricula) => matricula.tem_notas || matricula.tem_presencas)) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(409).json({
        success: false,
        message: 'Não é possível mudar de turma: um ou mais alunos já têm notas ou presenças registadas nesta matrícula. Os registos históricos foram preservados e nenhuma alteração foi feita.'
      });
    }

    for (const alunoId of alunoIds) {
      const matricula = matriculasPorAluno.get(alunoId);
      if (matricula) {
        await client.query(
          `UPDATE matriculas
           SET turma_id = $1, polo_id = $2, estado = 'ativa',
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = $3 AND escola_id = $4`,
          [turmaId, turmaDestino.rows[0].polo_id, matricula.id, escolaId]
        );
      } else {
        const numeroMatricula = `MAT-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        await client.query(
          `INSERT INTO matriculas
             (escola_id, polo_id, aluno_id, ano_letivo_id, turma_id,
              data_matricula, numero_matricula, estado)
           VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'ativa')`,
          [escolaId, turmaDestino.rows[0].polo_id, alunoId, anoLetivoId, turmaId, numeroMatricula]
        );
      }

      await client.query(
        `UPDATE alunos_turmas
         SET status = 'transferido'
         WHERE aluno_id = $1 AND ano_letivo_id = $2
           AND status = 'ativo' AND turma_id <> $3`,
        [alunoId, anoLetivoId, turmaId]
      );
      const ligacaoDestino = await client.query(
        `UPDATE alunos_turmas
         SET status = 'ativo'
         WHERE aluno_id = $1 AND turma_id = $2 AND ano_letivo_id = $3`,
        [alunoId, turmaId, anoLetivoId]
      );
      if (!ligacaoDestino.rowCount) {
        await client.query(
          `INSERT INTO alunos_turmas (aluno_id, turma_id, ano_letivo_id, status)
           VALUES ($1, $2, $3, 'ativo')`,
          [alunoId, turmaId, anoLetivoId]
        );
      }
    }

    await client.query('COMMIT');
    transacaoIniciada = false;
    return res.json({
      success: true,
      message: `${alunoIds.length} aluno(s) matriculado(s) ou transferido(s) para a turma selecionada.`,
      data: { alunos_atualizados: alunoIds.length, turma_id: turmaId, ano_letivo_id: anoLetivoId }
    });
  } catch (error) {
    if (transacaoIniciada && client) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('Erro ao reverter mudança de turma:', rollbackError);
      });
    }
    console.error('Erro ao mudar alunos de turma:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Já existe uma matrícula para um ou mais alunos neste ano letivo. Atualize a lista e tente novamente.'
      });
    }
    if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        message: 'A turma, o ano ou um dos alunos já não existe. Atualize os dados e tente novamente.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Não foi possível mudar os alunos de turma. Nenhuma alteração foi guardada.'
    });
  } finally {
    client?.release();
  }
});

// ============================================================
// ROTA: LISTAR ALUNOS AGRUPADOS / FILTRADOS POR TURMA E ESCOLA
// ============================================================
router.get('/:escolaId/alunos-por-turma', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { turma_id, ano_letivo_id, polo_id } = req.query;

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!canAccessSchool(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    if (!turma_id || !UUID_PATTERN.test(turma_id)
      || (ano_letivo_id && !UUID_PATTERN.test(ano_letivo_id))
      || (polo_id && !UUID_PATTERN.test(polo_id))) {
      return res.status(400).json({ success: false, message: "Turma, ano letivo ou polo inválido." });
    }

    let query = `
      SELECT 
        a.id AS aluno_id,
        a.apelido,
        a.genero,
        a.foto_url,
        a.regiao_morada,
        a.setor_morada,
        u.id AS utilizador_id,
        u.nome,
        u.email,
        u.telefone,
        u.login_id,
        u.status_ativo,
        t.id AS turma_id,
        t.nome AS turma_nome,
        t.classe,
        t.turno,
        an.ano_nome,
        at.status AS status_matricula,
        m.numero_matricula,
        encarregado.nome AS encarregado_nome,
        encarregado.telefone AS encarregado_telefone
      FROM alunos a
      JOIN utilizadores u ON u.id = a.utilizador_id
      JOIN associacoes_escola ae
        ON ae.utilizador_id = a.utilizador_id
        AND ae.escola_id = $1
        AND ae.status = 'ativo'
      JOIN papeis_utilizador pu
        ON pu.associacao_id = ae.id
        AND pu.papel = 'aluno'
      JOIN alunos_turmas at
        ON at.aluno_id = a.id
        AND at.status IN ('ativo', 'promovido', 'transferido', 'retido')
        AND at.turma_id = $2
      JOIN turmas t
        ON t.id = at.turma_id
        AND t.escola_id = $1
        AND t.ativo = true
      JOIN anos_letivos an ON an.id = at.ano_letivo_id
      LEFT JOIN LATERAL (
        SELECT m.numero_matricula
        FROM matriculas m
        WHERE m.aluno_id = a.id
          AND m.escola_id = $1
          AND m.turma_id = at.turma_id
          AND m.ano_letivo_id = at.ano_letivo_id
          AND m.estado IN ('ativa', 'concluida')
        ORDER BY m.criado_em DESC
        LIMIT 1
      ) m ON true
      LEFT JOIN LATERAL (
        SELECT uenc.nome, uenc.telefone
        FROM encarregado_alunos ea
        JOIN utilizadores uenc ON uenc.id = ea.utilizador_id
        WHERE ea.aluno_id = a.id
        ORDER BY ea.contacto_principal DESC, ea.criado_em DESC
        LIMIT 1
      ) encarregado ON true
      WHERE t.polo_id = COALESCE($3::uuid, t.polo_id)
        AND ($4::uuid IS NULL OR at.ano_letivo_id = $4)
    `;

    const params = [escolaId, turma_id, polo_id || null, ano_letivo_id || null];

    query += ` ORDER BY t.nome ASC, u.nome ASC;`;

    const resultado = await db.query(query, params);

    return res.json({
      success: true,
      total: resultado.rowCount,
      data: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar alunos por turma:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar alunos." });
  }
});


// ============================================================
// ROTA: PROMOVER OU MUDAR UM ALUNO INDIVIDUALMENTE DE TURMA
// ============================================================
router.get('/:escolaId/alunos/:alunoId/comprovar-pagamento', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId, alunoId } = req.params;
    const { ano_letivo_id: anoLetivoId } = req.query;
    if (!UUID_PATTERN.test(escolaId) || !UUID_PATTERN.test(alunoId) || !UUID_PATTERN.test(anoLetivoId || '')) {
      return res.status(400).json({ success: false, message: 'Aluno, escola e ano letivo válidos são obrigatórios.' });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Sem permissão para consultar pagamentos deste aluno.' });
    }

    const aluno = await db.query(
      `SELECT 1
       FROM alunos a
       JOIN associacoes_escola ae
         ON ae.utilizador_id = a.utilizador_id AND ae.escola_id = $2 AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'aluno'
       WHERE a.id = $1`,
      [alunoId, escolaId]
    );
    if (!aluno.rowCount) {
      return res.status(404).json({ success: false, message: 'Aluno não encontrado nesta escola.' });
    }

    const pagamentos = await db.query(
      `SELECT tp.id, tp.estado, tp.valor, tp.valor_configurado, tp.codigo_talao, tp.referencia_banco, tp.data_pagamento::text AS data_pagamento,
              tp.banco_origem,
              tp.ano_letivo_id, al.ano_nome, tp.polo_id, p.nome AS polo_nome,
              pt.nome AS item_nome, pt.tipo AS item_tipo
       FROM tesouraria_pagamentos tp
       JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
       JOIN anos_letivos al ON al.id = tp.ano_letivo_id
       LEFT JOIN polos_escola p ON p.id = tp.polo_id AND p.escola_id = tp.escola_id
       WHERE tp.escola_id = $1 AND tp.aluno_id = $2 AND tp.ano_letivo_id = $3
         AND tp.tipo_registo = 'candidato_novo'
       ORDER BY CASE tp.estado WHEN 'aprovado' THEN 0 WHEN 'pendente_aprovacao' THEN 1 ELSE 2 END,
                tp.criado_em DESC`,
      [escolaId, alunoId, anoLetivoId]
    );
    const pagamento = pagamentos.rows[0] || null;
    const valorConfere = pagamento &&
      pagamento.valor_configurado !== null &&
      Number.isFinite(Number(pagamento.valor_configurado)) &&
      Math.round(Number(pagamento.valor) * 100) === Math.round(Number(pagamento.valor_configurado) * 100);
    const pago = pagamento?.estado === 'aprovado' && valorConfere;
    const mensagem = pago
        ? 'Pagamento registado e associado a este aluno, polo e ano letivo.'
        : pagamento?.estado === 'aprovado' && !valorConfere
          ? 'O valor do pagamento não corresponde ao preço guardado para este polo.'
        : pagamento?.estado === 'flagged'
            ? 'O pagamento foi sinalizado e precisa de correção.'
          : 'Não foi encontrado um pagamento associado ao TAL ID para este aluno e ano letivo.';

    return res.json({
      success: true,
      data: { pago, pagamento, mensagem }
    });
  } catch (error) {
    console.error('Erro ao comprovar pagamento do aluno:', error);
    return res.status(500).json({ success: false, message: 'Erro ao consultar o pagamento do aluno.' });
  }
});

router.post('/:escolaId/alunos/atribuir-turma', verificarAutenticacao, async (req, res) => {
  let client;
  let transacaoIniciada = false;
  try {
    const { escolaId } = req.params;
    const { aluno_id, ano_letivo_id, polo_id, turma_id } = req.body || {};
    if (!UUID_PATTERN.test(escolaId) || !UUID_PATTERN.test(aluno_id || '') ||
        !UUID_PATTERN.test(ano_letivo_id || '') || !UUID_PATTERN.test(polo_id || '') ||
        !UUID_PATTERN.test(turma_id || '')) {
      return res.status(400).json({ success: false, message: 'Informe aluno, ano letivo, polo e turma válidos.' });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem efetuar matrículas.' });
    }

    client = await db.connect();
    await client.query('BEGIN');
    transacaoIniciada = true;

    const periodoAberto = await client.query(
      `SELECT eal.ano_letivo_id
       FROM escola_anos_letivos eal
       JOIN prazos_matricula pm
         ON pm.escola_id = eal.escola_id
        AND pm.anos_letivo_id = eal.ano_letivo_id
       WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2
         AND pm.ativo = true
         AND CURRENT_DATE BETWEEN pm.data_inicio AND pm.data_fim
       FOR SHARE OF eal, pm`,
      [escolaId, ano_letivo_id]
    );
    if (!periodoAberto.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(423).json({ success: false, message: 'O período de matrícula deste ano letivo está fechado.' });
    }

    const aluno = await client.query(
      `SELECT a.id
       FROM alunos a
       JOIN associacoes_escola ae
         ON ae.utilizador_id = a.utilizador_id AND ae.escola_id = $2 AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'aluno'
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [aluno_id, escolaId]
    );
    if (!aluno.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(404).json({ success: false, message: 'Aluno não encontrado nesta escola.' });
    }

    const jaMatriculado = await client.query(
      `SELECT 1
       FROM matriculas m
       LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
       WHERE m.escola_id = $1 AND m.aluno_id = $2 AND m.estado = 'ativa'
         AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $3
       LIMIT 1`,
      [escolaId, aluno_id, ano_letivo_id]
    );
    if (jaMatriculado.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(409).json({ success: false, message: 'Este aluno já tem uma matrícula ativa neste ano letivo.' });
    }

    const turma = await client.query(
      `SELECT t.id
       FROM turmas t
       JOIN polos_escola p ON p.id = t.polo_id AND p.escola_id = t.escola_id
       WHERE t.id = $1 AND t.escola_id = $2 AND t.polo_id = $3
         AND t.ano_letivo_id = $4 AND t.ativo = true AND p.ativo = true
       FOR UPDATE OF t`,
      [turma_id, escolaId, polo_id, ano_letivo_id]
    );
    if (!turma.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(400).json({ success: false, message: 'A turma não pertence ao polo e ano letivo selecionados, ou está inativa.' });
    }

    const numeroMatricula = `MAT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const matricula = await client.query(
      `INSERT INTO matriculas
         (escola_id, polo_id, aluno_id, ano_letivo_id, turma_id, data_matricula, numero_matricula, estado)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'ativa')
       RETURNING id, numero_matricula`,
      [escolaId, polo_id, aluno_id, ano_letivo_id, turma_id, numeroMatricula]
    );
    await client.query(
      `INSERT INTO alunos_turmas (aluno_id, turma_id, ano_letivo_id, status)
       VALUES ($1, $2, $3, 'ativo')`,
      [aluno_id, turma_id, ano_letivo_id]
    );
    await client.query('COMMIT');
    transacaoIniciada = false;
    return res.status(201).json({
      success: true,
      message: 'Aluno matriculado na turma com sucesso.',
      data: { ...matricula.rows[0], aluno_id, ano_letivo_id, polo_id, turma_id }
    });
  } catch (error) {
    if (transacaoIniciada && client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao reverter a matrícula:', rollbackError);
      }
    }
    console.error('Erro ao atribuir turma ao aluno:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Já existe uma matrícula para este aluno, ano letivo ou número de matrícula.' });
    }
    return res.status(500).json({ success: false, message: 'Erro ao concluir a matrícula do aluno.' });
  } finally {
    client?.release();
  }
});

router.post('/:alunoId/promover', verificarAutenticacao, async (req, res) => {
  let client;
  let transacaoIniciada = false;
  try {
    const { alunoId } = req.params;
    const { nova_turma_id, novo_ano_letivo_id, status_destino } = req.body || {}; 
    const escolaId = req.contaAtiva?.escola_id;

    if (!UUID_PATTERN.test(alunoId || '')
      || !UUID_PATTERN.test(nova_turma_id || '')
      || !UUID_PATTERN.test(novo_ano_letivo_id || '')
      || !UUID_PATTERN.test(escolaId || '')) {
      return res.status(400).json({ success: false, message: "Os identificadores do aluno, da escola, da nova turma e do ano letivo devem ser válidos." });
    }
    if (status_destino && !['promovido', 'transferido', 'retido'].includes(status_destino)) {
      return res.status(400).json({ success: false, message: "O estado de destino informado é inválido." });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Sem permissão para matricular este aluno.' });
    }

    client = await db.connect();
    await client.query('BEGIN');
    transacaoIniciada = true;
    const aluno = await client.query(
      `SELECT a.id
       FROM alunos a
       JOIN associacoes_escola ae
         ON ae.utilizador_id = a.utilizador_id
        AND ae.escola_id = $2 AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id AND LOWER(TRIM(pu.papel)) = 'aluno'
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [alunoId, escolaId]
    );
    if (!aluno.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(404).json({ success: false, message: 'Aluno não encontrado nesta escola.' });
    }

    const turmaDestino = await client.query(
      `SELECT t.id, t.polo_id
       FROM turmas t
       JOIN escola_anos_letivos eal
         ON eal.escola_id = t.escola_id
        AND eal.ano_letivo_id = t.ano_letivo_id
       WHERE t.id = $1 AND t.escola_id = $2
         AND t.ano_letivo_id = $3 AND t.ativo = true
       FOR UPDATE OF t`,
      [nova_turma_id, escolaId, novo_ano_letivo_id]
    );
    if (turmaDestino.rowCount === 0) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(400).json({
        success: false,
        message: "A turma de destino não está ativa nesta escola ou não pertence ao ano letivo selecionado."
      });
    }

    const matriculaDestinoExistente = await client.query(
      `SELECT id, estado
       FROM matriculas
       WHERE escola_id = $1 AND aluno_id = $2 AND ano_letivo_id = $3
       FOR UPDATE`,
      [escolaId, alunoId, novo_ano_letivo_id]
    );
    if (matriculaDestinoExistente.rowCount) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(409).json({
        success: false,
        message: 'Este aluno já tem um registo de matrícula no ano letivo de destino. Consulte-o antes de promover novamente.'
      });
    }

    const matriculaOrigem = await client.query(
      `SELECT m.id, m.turma_id, m.ano_letivo_id
       FROM matriculas m
       JOIN escola_anos_letivos ano_origem
         ON ano_origem.escola_id = m.escola_id
        AND ano_origem.ano_letivo_id = m.ano_letivo_id
       JOIN escola_anos_letivos ano_destino
         ON ano_destino.escola_id = $1
        AND ano_destino.ano_letivo_id = $3
       WHERE m.escola_id = $1 AND m.aluno_id = $2
         AND m.estado = 'ativa'
         AND ano_origem.data_inicio < ano_destino.data_inicio
       ORDER BY ano_origem.data_inicio DESC, m.criado_em DESC
       LIMIT 1
       FOR UPDATE OF m`,
      [escolaId, alunoId, novo_ano_letivo_id]
    );

    const numeroMatricula = `MAT-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const novaMatricula = await client.query(
      `INSERT INTO matriculas
         (escola_id, polo_id, aluno_id, ano_letivo_id, turma_id,
          data_matricula, numero_matricula, estado)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'ativa')
       RETURNING id, numero_matricula`,
      [escolaId, turmaDestino.rows[0].polo_id, alunoId, novo_ano_letivo_id, nova_turma_id, numeroMatricula]
    );

    if (matriculaOrigem.rowCount) {
      await client.query(
        `UPDATE alunos_turmas
         SET status = $1
         WHERE aluno_id = $2 AND turma_id = $3 AND ano_letivo_id = $4
           AND status = 'ativo'`,
        [
          status_destino || 'promovido',
          alunoId,
          matriculaOrigem.rows[0].turma_id,
          matriculaOrigem.rows[0].ano_letivo_id
        ]
      );
      await client.query(
        `UPDATE matriculas
         SET estado = 'concluida', atualizado_em = CURRENT_TIMESTAMP
         WHERE id = $1 AND estado = 'ativa'`,
        [matriculaOrigem.rows[0].id]
      );
    }

    await client.query(
      `UPDATE alunos_turmas
       SET status = 'ativo'
       WHERE aluno_id = $1 AND turma_id = $2 AND ano_letivo_id = $3`,
      [alunoId, nova_turma_id, novo_ano_letivo_id]
    );
    const ligacaoDestino = await client.query(
      `SELECT id FROM alunos_turmas
       WHERE aluno_id = $1 AND turma_id = $2 AND ano_letivo_id = $3
       LIMIT 1`,
      [alunoId, nova_turma_id, novo_ano_letivo_id]
    );
    if (!ligacaoDestino.rowCount) {
      await client.query(
        `INSERT INTO alunos_turmas (aluno_id, turma_id, ano_letivo_id, status)
         VALUES ($1, $2, $3, 'ativo')`,
        [alunoId, nova_turma_id, novo_ano_letivo_id]
      );
    }

    await client.query('COMMIT');
    transacaoIniciada = false;

    return res.json({
      success: true,
      message: 'Aluno matriculado na nova turma. O registo do ano letivo anterior foi mantido.',
      data: {
        ...novaMatricula.rows[0],
        aluno_id: alunoId,
        ano_letivo_id: novo_ano_letivo_id,
        turma_id: nova_turma_id,
        matricula_origem_id: matriculaOrigem.rows[0]?.id || null
      }
    });

  } catch (error) {
    if (transacaoIniciada && client) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('Erro ao reverter a promoção do aluno:', rollbackError);
      });
    }
    console.error("Erro ao promover aluno:", error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Já existe uma matrícula para este aluno no ano letivo de destino.' });
    }
    return res.status(500).json({ success: false, message: "Erro ao processar a promoção do aluno." });
  } finally {
    client?.release();
  }
});


// ============================================================
// ROTA: PROMOVER EM LOTE (TURMA INTEIRA)
// ============================================================
router.post('/turmas/promover-lote', verificarAutenticacao, async (req, res) => {
  let client;
  let transacaoIniciada = false;
  try {
    client = await db.connect();
    const {
      turma_origem_id,
      turma_destino_id,
      ano_letivo_origem_id,
      novo_ano_letivo_id
    } = req.body || {};
    const escolaId = req.contaAtiva?.escola_id;

    if (!escolaId || !UUID_PATTERN.test(turma_origem_id || '')
      || !UUID_PATTERN.test(turma_destino_id || '')
      || !UUID_PATTERN.test(ano_letivo_origem_id || '')
      || !UUID_PATTERN.test(novo_ano_letivo_id || '')
      || ano_letivo_origem_id === novo_ano_letivo_id
      || turma_origem_id === turma_destino_id) {
      return res.status(400).json({ success: false, message: "Escola, turmas e anos letivos válidos são obrigatórios." });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Sem permissão para promover alunos desta escola.' });
    }

    await client.query("BEGIN");
    transacaoIniciada = true;

    const anosRes = await client.query(
      `SELECT ano_letivo_id, data_inicio
       FROM escola_anos_letivos
       WHERE escola_id = $1 AND ano_letivo_id = ANY($2::uuid[])`,
      [escolaId, [ano_letivo_origem_id, novo_ano_letivo_id]]
    );
    if (anosRes.rowCount !== 2) {
      await client.query("ROLLBACK");
      transacaoIniciada = false;
      return res.status(400).json({ success: false, message: "Os anos letivos devem estar configurados para esta escola." });
    }
    const anoOrigem = anosRes.rows.find((ano) => ano.ano_letivo_id === ano_letivo_origem_id);
    const anoDestino = anosRes.rows.find((ano) => ano.ano_letivo_id === novo_ano_letivo_id);
    if (!anoOrigem?.data_inicio || !anoDestino?.data_inicio || anoDestino.data_inicio <= anoOrigem.data_inicio) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(400).json({ success: false, message: 'O ano letivo de destino deve ser posterior ao ano letivo de origem.' });
    }

    const turmasRes = await client.query(
      `SELECT id, escola_id, polo_id, ano_letivo_id
       FROM turmas
       WHERE id = ANY($1::uuid[]) AND escola_id = $2 AND ativo = true
       FOR UPDATE`,
      [[turma_origem_id, turma_destino_id], escolaId]
    );
    const turmaOrigem = turmasRes.rows.find((turma) => turma.id === turma_origem_id);
    const turmaDestino = turmasRes.rows.find((turma) => turma.id === turma_destino_id);
    if (!turmaOrigem || !turmaDestino
      || turmaOrigem.polo_id !== turmaDestino.polo_id
      || turmaOrigem.ano_letivo_id !== ano_letivo_origem_id
      || turmaDestino.ano_letivo_id !== novo_ano_letivo_id) {
      await client.query("ROLLBACK");
      transacaoIniciada = false;
      return res.status(400).json({ success: false, message: "As turmas devem pertencer à escola e ao mesmo polo, e cada turma deve estar associada ao ano letivo selecionado." });
    }

    // 1. Buscar todos os alunos ativos na turma de origem
    const alunosOrigem = await client.query(
      `SELECT aluno_id
       FROM alunos_turmas
       WHERE turma_id = $1 AND ano_letivo_id = $2 AND status = 'ativo'`,
      [turma_origem_id, ano_letivo_origem_id]
    );

    if (alunosOrigem.rowCount === 0) {
      await client.query("ROLLBACK");
      transacaoIniciada = false;
      return res.status(404).json({ success: false, message: "Nenhum aluno ativo encontrado na turma de origem." });
    }

    const alunoIdsOrigem = alunosOrigem.rows.map((row) => row.aluno_id);
    const matriculasDestino = await client.query(
      `SELECT aluno_id, turma_id, estado
       FROM matriculas
       WHERE escola_id = $1 AND ano_letivo_id = $2
         AND aluno_id = ANY($3::uuid[])
       ORDER BY aluno_id
       FOR UPDATE`,
      [escolaId, novo_ano_letivo_id, alunoIdsOrigem]
    );
    const destinosIncompativeis = matriculasDestino.rows.filter((matricula) => (
      matricula.turma_id !== turma_destino_id || matricula.estado !== 'ativa'
    ));
    if (destinosIncompativeis.length) {
      await client.query('ROLLBACK');
      transacaoIniciada = false;
      return res.status(409).json({
        success: false,
        message: 'Um ou mais alunos já têm matrícula no ano letivo de destino. Resolva essas matrículas antes de promover a turma.'
      });
    }
    const alunosComMatriculaDestino = new Set(matriculasDestino.rows.map((matricula) => matricula.aluno_id));

    // 2. Marcar todos da turma antiga como promovidos
    await client.query(
      `UPDATE alunos_turmas
       SET status = 'promovido'
       WHERE turma_id = $1 AND ano_letivo_id = $2 AND status = 'ativo'`,
      [turma_origem_id, ano_letivo_origem_id]
    );
    await client.query(
      `UPDATE matriculas
       SET estado = 'concluida', atualizado_em = CURRENT_TIMESTAMP
       WHERE escola_id = $1 AND turma_id = $2 AND ano_letivo_id = $3
         AND aluno_id = ANY($4::uuid[]) AND estado = 'ativa'`,
      [escolaId, turma_origem_id, ano_letivo_origem_id, alunoIdsOrigem]
    );

    // 3. Inscrever cada aluno na nova turma
    for (const row of alunosOrigem.rows) {
      if (!alunosComMatriculaDestino.has(row.aluno_id)) {
        const numeroMatricula = `MAT-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        await client.query(
          `INSERT INTO matriculas
             (escola_id, polo_id, aluno_id, ano_letivo_id, turma_id,
              data_matricula, numero_matricula, estado)
           VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'ativa')`,
          [escolaId, turmaDestino.polo_id, row.aluno_id, novo_ano_letivo_id, turma_destino_id, numeroMatricula]
        );
      }

      const ligacaoDestino = await client.query(
        `UPDATE alunos_turmas
         SET status = 'ativo'
         WHERE aluno_id = $1 AND turma_id = $2 AND ano_letivo_id = $3`,
        [row.aluno_id, turma_destino_id, novo_ano_letivo_id]
      );
      if (!ligacaoDestino.rowCount) {
        await client.query(
          `INSERT INTO alunos_turmas (aluno_id, turma_id, ano_letivo_id, status)
           VALUES ($1, $2, $3, 'ativo')`,
          [row.aluno_id, turma_destino_id, novo_ano_letivo_id]
        );
      }
    }

    await client.query("COMMIT");
    transacaoIniciada = false;

    return res.json({
      success: true,
      message: `Turma promovida com sucesso! ${alunosOrigem.rowCount} aluno(s) foram inscritos no novo ano letivo. Os registos da turma anterior foram mantidos.`
    });

  } catch (error) {
    if (client && transacaoIniciada) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error('Erro ao reverter a promoção em lote:', rollbackError);
      }
    }
    console.error("Erro na promoção em lote:", error);
    return res.status(500).json({ success: false, message: "Erro ao executar promoção em lote." });
  } finally {
    client?.release();
  }
});


// ============================================================
// ROTA: ALTERAR ESTADO / DESATIVAR CONTA DO ALUNO
// ============================================================
router.put('/:alunoId/status', verificarAutenticacao, async (req, res) => {
  try {
    const { alunoId } = req.params;
    const { status_ativo } = req.body; // true ou false

    if (!UUID_PATTERN.test(alunoId) || typeof status_ativo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Aluno ou estado da conta inválido.' });
    }
    const escolaId = req.contaAtiva?.escola_id || null;
    if ((!req.user?.isOwner && !escolaId) || (escolaId && !canManageStudent(req, escolaId))) {
      return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem alterar o estado da conta.' });
    }

    const alunoRes = await db.query(
      `SELECT a.utilizador_id
       FROM alunos a
       WHERE a.id = $1
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1
           FROM associacoes_escola ae
           JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
           WHERE ae.utilizador_id = a.utilizador_id
             AND ae.escola_id = $2
             AND ae.status = 'ativo'
             AND LOWER(TRIM(pu.papel)) = 'aluno'
         ))`,
      [alunoId, escolaId]
    );
    if (alunoRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const utilizadorId = alunoRes.rows[0].utilizador_id;

    // Atualizar na tabela utilizadores
    await db.query(
      `UPDATE utilizadores SET status_ativo = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2`,
      [status_ativo, utilizadorId]
    );

    return res.json({
      success: true,
      message: `Conta do aluno ${status_ativo ? 'ativada' : 'desativada'} com sucesso.`
    });

  } catch (error) {
    console.error("Erro ao alterar status do aluno:", error);
    return res.status(500).json({ success: false, message: "Erro ao alterar o estado da conta." });
  }
});

router.post('/:escolaId/alunos/:alunoId/senha', verificarAutenticacao, async (req, res) => {
  const { escolaId, alunoId } = req.params;
  const novaSenha = req.body?.nova_senha;
  if (!UUID_PATTERN.test(escolaId || '') || !UUID_PATTERN.test(alunoId || '')) {
    return res.status(400).json({ success: false, message: 'Escola ou aluno inválido.' });
  }
  if (!canManageStudent(req, escolaId)) {
    return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem redefinir a senha de alunos desta escola.' });
  }
  if (typeof novaSenha !== 'string' || novaSenha.length < 6 || novaSenha.length > 128) {
    return res.status(400).json({ success: false, message: 'A nova senha deve ter entre 6 e 128 caracteres.' });
  }

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const aluno = await client.query(
      `SELECT a.utilizador_id
       FROM alunos a
       JOIN associacoes_escola ae
         ON ae.utilizador_id = a.utilizador_id
        AND ae.escola_id = $2
        AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id
        AND LOWER(TRIM(pu.papel)) = 'aluno'
       JOIN utilizadores u ON u.id = a.utilizador_id
       WHERE a.id = $1 AND u.tipo_conta <> 'owner'
       FOR UPDATE OF u`,
      [alunoId, escolaId]
    );
    if (!aluno.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Aluno não encontrado nesta escola.' });
    }

    const utilizadorId = aluno.rows[0].utilizador_id;
    const passwordHash = await hashPassword(novaSenha);
    await client.query(
      `UPDATE utilizadores
       SET password_hash = $1, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, utilizadorId]
    );
    await client.query(
      `UPDATE sessoes SET revogado = true
       WHERE utilizador_id = $1 AND revogado IS NOT TRUE`,
      [utilizadorId]
    );
    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Senha do aluno alterada. Todas as sessões abertas foram terminadas.'
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('Erro ao reverter redefinição de senha do aluno:', rollbackError);
      });
    }
    console.error('Erro ao redefinir senha de aluno:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível alterar a senha do aluno.' });
  } finally {
    client?.release();
  }
});


// ============================================================
// ROTA: EXCLUIR ALUNO COM SEGURANÇA
// ============================================================
router.delete('/:alunoId', verificarAutenticacao, async (req, res) => {
  const client = await db.connect();
  try {
    const { alunoId } = req.params;

    await client.query("BEGIN");

    const alunoRes = await client.query(`SELECT utilizador_id FROM alunos WHERE id = $1`, [alunoId]);
    if (alunoRes.rowCount === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ success: false, message: "Aluno não encontrado." });
    }
    const utilizadorId = alunoRes.rows[0].utilizador_id;

    // Excluir aluno (a cascata remove matrículas e associações se configurada na BD, ou removemos explicitamente)
    await client.query(`DELETE FROM alunos WHERE id = $1`, [alunoId]);
    await client.query(`DELETE FROM utilizadores WHERE id = $1`, [utilizadorId]);

    await client.query("COMMIT");
    client.release();

    return res.json({ success: true, message: "Aluno removido do sistema com sucesso." });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    console.error("Erro ao excluir aluno:", error);
    return res.status(500).json({ success: false, message: "Erro ao excluir o aluno." });
  }
});

// ============================================================
// ROTA: LISTAR ENCARREGADOS DA ESCOLA COM OS SEUS ALUNOS AFILIADOS
// ============================================================
router.get('/escolas/:escolaId/encarregados', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const { pesquisa, parentesco, ano_letivo_id, polo_id } = req.query;

    if (!UUID_PATTERN.test(escolaId)) {
      return res.status(400).json({ success: false, message: "Identificador da escola inválido." });
    }
    if (!canAccessSchool(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    if ((ano_letivo_id && !UUID_PATTERN.test(ano_letivo_id))
      || (polo_id && !UUID_PATTERN.test(polo_id))) {
      return res.status(400).json({ success: false, message: "Ano letivo ou ramo inválido." });
    }

    const params = [escolaId];
    const filters = ["ae.escola_id = $1", "ae.status = 'ativo'"];
    if (ano_letivo_id) {
      params.push(ano_letivo_id);
      filters.push(`COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $${params.length}`);
    }
    if (polo_id) {
      params.push(polo_id);
      filters.push(`COALESCE(m.polo_id, t.polo_id) = $${params.length}`);
    }
    if (typeof pesquisa === 'string' && pesquisa.trim()) {
      params.push(`%${pesquisa.trim()}%`);
      filters.push(`(u.nome ILIKE $${params.length} OR ea.apelido ILIKE $${params.length} OR u.login_id ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.telefone ILIKE $${params.length})`);
    }
    if (typeof parentesco === 'string' && parentesco !== 'Todos') {
      params.push(parentesco);
      filters.push(`ea.parentesco = $${params.length}`);
    }

    const resultado = await db.query(
      `
      SELECT 
        u.id AS encarregado_id,
        u.email AS encarregado_email,
        u.nome AS encarregado_nome,
        u.login_id AS encarregado_login_id,
        MAX(ea.apelido) AS encarregado_apelido,
        u.telefone AS encarregado_telefone,
        MAX(ea.parentesco) AS parentesco,
        MAX(ea.occupacao) AS encarregado_occupacao,
        MAX(ea.regiao_morada) AS encarregado_regiao_morada,
        MAX(ea.setor_morada) AS encarregado_setor_morada,
        json_agg(DISTINCT jsonb_build_object(
            'aluno_id', a.id,
            'nome', aluno.nome,
            'apelido', a.apelido,
            'email', aluno.email,
            'login_id', aluno.login_id,
            'genero', a.genero,
          'foto_url', a.foto_url,
          'polo_id', m.polo_id,
          'polo_nome', p.nome,
          'turma_id', t.id,
          'turma_nome', t.nome,
          'classe', t.classe,
          'estado_matricula', m.estado
        )) AS alunos
      FROM associacoes_escola ae
      JOIN papeis_utilizador pu
        ON pu.associacao_id = ae.id
        AND pu.papel = 'encarregado'
      JOIN utilizadores u ON u.id = ae.utilizador_id
      JOIN encarregado_alunos ea ON ea.utilizador_id = u.id
      JOIN alunos a ON a.id = ea.aluno_id
      JOIN utilizadores aluno ON aluno.id = a.utilizador_id
      JOIN matriculas m
        ON m.aluno_id = a.id
        AND m.escola_id = ae.escola_id
        AND m.estado IN ('ativa', 'pendente')
      LEFT JOIN polos_escola p
        ON p.id = m.polo_id
        AND p.escola_id = m.escola_id
      LEFT JOIN turmas t
        ON t.id = m.turma_id
        AND t.escola_id = m.escola_id
      JOIN associacoes_escola associacao_aluno
        ON associacao_aluno.utilizador_id = a.utilizador_id
        AND associacao_aluno.escola_id = ae.escola_id
        AND associacao_aluno.status = 'ativo'
      JOIN papeis_utilizador papel_aluno
        ON papel_aluno.associacao_id = associacao_aluno.id
        AND papel_aluno.papel = 'aluno'
      WHERE ${filters.join(' AND ')}
      GROUP BY u.id, u.nome, u.email, u.telefone
      ORDER BY u.nome ASC
      `,
      params
    );

    return res.json({
      success: true,
      total: resultado.rowCount,
      dados: resultado.rows
    });

  } catch (error) {
    console.error("Erro ao listar encarregados:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar encarregados." });
  }
});

router.get('/:escolaId/encarregados/buscar', verificarAutenticacao, async (req, res) => {
  try {
    const { escolaId } = req.params;
    const termo = typeof req.query.termo === 'string' ? req.query.termo.trim() : '';
    if (!UUID_PATTERN.test(escolaId || '')) {
      return res.status(400).json({ success: false, message: 'Identificador da escola inválido.' });
    }
    if (!canManageStudent(req, escolaId)) {
      return res.status(403).json({ success: false, message: 'Apenas a Direção ou a Secretaria podem pesquisar encarregados desta escola.' });
    }
    if (termo.length < 2 || termo.length > 100) {
      return res.status(400).json({ success: false, message: 'Informe um termo de pesquisa entre 2 e 100 caracteres.' });
    }

    const resultado = await db.query(
      `SELECT u.id AS encarregado_id,
              u.nome AS encarregado_nome,
              MAX(ea.apelido) AS encarregado_apelido,
              u.login_id AS encarregado_login_id,
              u.email AS encarregado_email,
              u.telefone AS encarregado_telefone
       FROM utilizadores u
       JOIN associacoes_escola ae
         ON ae.utilizador_id = u.id
        AND ae.escola_id = $1
        AND ae.status = 'ativo'
       JOIN papeis_utilizador pu
         ON pu.associacao_id = ae.id
        AND LOWER(TRIM(pu.papel)) = 'encarregado'
       JOIN encarregado_alunos ea ON ea.utilizador_id = u.id
       WHERE u.tipo_conta <> 'owner'
         AND EXISTS (
           SELECT 1
           FROM alunos a
           JOIN associacoes_escola associacao_aluno
             ON associacao_aluno.utilizador_id = a.utilizador_id
            AND associacao_aluno.escola_id = $1
            AND associacao_aluno.status = 'ativo'
           JOIN papeis_utilizador papel_aluno
             ON papel_aluno.associacao_id = associacao_aluno.id
            AND LOWER(TRIM(papel_aluno.papel)) = 'aluno'
           WHERE a.id = ea.aluno_id
         )
         AND (u.nome ILIKE $2 OR ea.apelido ILIKE $2
              OR u.login_id ILIKE $2 OR u.email ILIKE $2 OR u.telefone ILIKE $2)
       GROUP BY u.id, u.nome, u.login_id, u.email, u.telefone
       ORDER BY u.nome ASC
       LIMIT 25`,
      [escolaId, `%${termo}%`]
    );
    return res.json({ success: true, total: resultado.rowCount, dados: resultado.rows });
  } catch (error) {
    console.error('Erro ao pesquisar encarregados para redefinição de senha:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível pesquisar encarregados.' });
  }
});


// ============================================================
// ROTA: ENVIAR MENSAGEM EM LOTE PARA ENCARREGADOS SELECIONADOS
// ============================================================
router.post('/escolas/encarregados/enviar-mensagem', verificarAutenticacao, async (req, res) => {
  try {
    const { emails, assunto, mensagem, escola_id: escolaId } = req.body || {};

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ success: false, message: "Nenhum encarregado selecionado." });
    }

    if (!UUID_PATTERN.test(escolaId || '') || !canAccessSchool(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    if (!emails.every((email) => typeof email === 'string' && EMAIL_PATTERN.test(email))) {
      return res.status(400).json({ success: false, message: "A lista de endereços de email é inválida." });
    }
    if (typeof assunto !== 'string' || !assunto.trim() || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ success: false, message: "Assunto e mensagem são obrigatórios." });
    }

    const destinatarios = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
    const validos = await db.query(
      `SELECT DISTINCT u.email
       FROM associacoes_escola ae
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id AND pu.papel = 'encarregado'
       JOIN utilizadores u ON u.id = ae.utilizador_id
       JOIN encarregado_alunos ea ON ea.utilizador_id = u.id
       JOIN alunos a ON a.id = ea.aluno_id
       JOIN associacoes_escola sae
         ON sae.utilizador_id = a.utilizador_id AND sae.escola_id = ae.escola_id AND sae.status = 'ativo'
       JOIN papeis_utilizador spu ON spu.associacao_id = sae.id AND spu.papel = 'aluno'
       WHERE ae.escola_id = $1 AND ae.status = 'ativo' AND lower(u.email) = ANY($2::text[])`,
      [escolaId, destinatarios]
    );
    if (validos.rowCount !== destinatarios.length) {
      return res.status(400).json({ success: false, message: "Um ou mais encarregados já não pertencem a esta escola." });
    }

    const transporter = getEmailTransporter();
    if (!transporter) {
      return res.status(503).json({ success: false, message: "O serviço de email não está configurado no servidor." });
    }

    for (const destinatario of destinatarios) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: destinatario,
        subject: assunto.trim(),
        text: mensagem.trim()
      });
    }

    return res.json({ success: true, message: `Mensagem enviada para ${destinatarios.length} encarregado(s).` });
  } catch (error) {
    console.error("Erro ao enviar mensagem em lote:", error);
    return res.status(500).json({ success: false, message: "Erro ao enviar mensagens." });
  }
});


// ============================================================
// ROTA: ENVIAR EMAIL INDIVIDUAL (ENCARREGADO OU ALUNO)
// ============================================================
router.post('/escolas/enviar-email-individual', verificarAutenticacao, async (req, res) => {
  try {
    const { destinatario, assunto, mensagem, escola_id: escolaId } = req.body || {};

    if (!UUID_PATTERN.test(escolaId || '') || !canAccessSchool(req, escolaId)) {
      return res.status(403).json({ success: false, message: "A escola solicitada não corresponde à conta ativa." });
    }
    if (typeof destinatario !== 'string' || !EMAIL_PATTERN.test(destinatario)
      || typeof assunto !== 'string' || !assunto.trim()
      || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ success: false, message: "Preencha todos os campos do email." });
    }

    const destinatarioRes = await db.query(
      `SELECT 1
       FROM associacoes_escola ae
       JOIN utilizadores u ON u.id = ae.utilizador_id
       JOIN papeis_utilizador pu ON pu.associacao_id = ae.id
       WHERE ae.escola_id = $1 AND ae.status = 'ativo'
         AND lower(u.email) = lower($2)
         AND pu.papel IN ('encarregado', 'aluno')
       LIMIT 1`,
      [escolaId, destinatario.trim()]
    );
    if (destinatarioRes.rowCount === 0) {
      return res.status(400).json({ success: false, message: "O destinatário não pertence a esta escola." });
    }

    const transporter = getEmailTransporter();
    if (!transporter) {
      return res.status(503).json({ success: false, message: "O serviço de email não está configurado no servidor." });
    }
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: destinatario.trim(),
      subject: assunto.trim(),
      text: mensagem.trim()
    });

    return res.json({
      success: true,
      message: `Email enviado com sucesso para ${destinatario}!`
    });

  } catch (error) {
    console.error("Erro ao enviar email individual:", error);
    return res.status(500).json({ success: false, message: "Erro ao enviar email." });
  }
});

module.exports = router;