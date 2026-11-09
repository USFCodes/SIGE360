const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { verificarAutenticacao } = require('../middlewares/middleware');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIODICIDADES = ['unica', 'mensal', 'trimestral', 'anual'];
const TIPOS_PAGAMENTO = ['propina', 'matricula', 'inscricao', 'exame', 'transporte', 'alimentacao', 'outro'];

function podeGerirConfiguracaoTesouraria(req) {
    const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
        .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return req.user?.isOwner === true || ['direcao', 'tesouraria'].includes(papel);
}

function podeDefinirPrecosPorPolo(req) {
    const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
        .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return req.user?.isOwner === true || papel === 'direcao';
}

function podeVincularTalaoSecretaria(req) {
    const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
        .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return req.user?.isOwner === true || [
        'direcao',
        'secretaria',
        'secretario',
        'secretaria escolar',
        'secretario escolar'
    ].includes(papel);
}

function formatarMontanteNotificacao(valor) {
    return Number(valor || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 });
}

function validarNiveis(ids) {
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string' && UUID_PATTERN.test(id)) &&
        new Set(ids).size === ids.length;
}

function precosPoloValidos(precos) {
    return Array.isArray(precos) && precos.every((item) =>
        item && UUID_PATTERN.test(item.polo_id || '') &&
        Number.isFinite(Number(item.valor)) && Number(item.valor) > 0
    ) && new Set(precos.map((item) => item.polo_id)).size === precos.length;
}

function precosClasseValidos(precos) {
    return Array.isArray(precos) && precos.length === 1 && precos.every((item) =>
        item && typeof item.classe === 'string' && item.classe.trim().length > 0 &&
        item.classe.trim().length <= 100 &&
        Number.isFinite(Number(item.valor)) && Number(item.valor) > 0 &&
        dataIsoValida(item.data_vencimento)
    );
}

async function validarPrecoIndividualClasse(client, escolaId, anoLetivoId, preco) {
    if (!UUID_PATTERN.test(anoLetivoId || '') || !precosClasseValidos([preco])) return false;
    const resultado = await client.query(
        `SELECT eal.data_inicio::text AS data_inicio, eal.data_fim::text AS data_fim
         FROM escola_anos_letivos eal
         JOIN turmas t
           ON t.escola_id = eal.escola_id
          AND t.ano_letivo_id = eal.ano_letivo_id
          AND LOWER(BTRIM(t.classe)) = LOWER(BTRIM($3))
         WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2
         LIMIT 1`,
        [escolaId, anoLetivoId, preco.classe.trim()]
    );
    if (resultado.rowCount !== 1) return false;
    const dataVencimento = preco.data_vencimento;
    const { data_inicio: dataInicio, data_fim: dataFim } = resultado.rows[0];
    return (!dataInicio || dataVencimento >= String(dataInicio).slice(0, 10)) &&
        (!dataFim || dataVencimento <= String(dataFim).slice(0, 10));
}

async function guardarPrecoClasse(client, itemId, escolaId, anoLetivoId, preco) {
    await client.query(
        `INSERT INTO propinas_taxas_classes
           (propina_taxa_id, escola_id, classe, ano_letivo_id, valor, data_vencimento)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (propina_taxa_id, (LOWER(BTRIM(classe))), ano_letivo_id)
         DO UPDATE SET valor = EXCLUDED.valor,
                       data_vencimento = EXCLUDED.data_vencimento,
                       atualizado_em = CURRENT_TIMESTAMP`,
        [itemId, escolaId, preco.classe.trim(), anoLetivoId, Number(preco.valor), preco.data_vencimento]
    );
}

async function validarPrecoIndividualPolo(client, escolaId, anoLetivoId, preco) {
    if (!UUID_PATTERN.test(anoLetivoId || '') || !precosPoloValidos([preco]) ||
        !dataIsoValida(preco.data_vencimento)) return false;
    const resultado = await client.query(
        `SELECT eal.data_inicio::text AS data_inicio, eal.data_fim::text AS data_fim
         FROM escola_anos_letivos eal
         JOIN polos_escola p ON p.escola_id = eal.escola_id AND p.id = $3 AND p.ativo = true
         WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2
           AND eal.data_inicio IS NOT NULL AND eal.data_fim IS NOT NULL
           AND eal.data_inicio <= eal.data_fim`,
        [escolaId, anoLetivoId, preco.polo_id]
    );
    if (resultado.rowCount !== 1) return false;
    const ano = resultado.rows[0];
    return preco.data_vencimento >= String(ano.data_inicio).slice(0, 10) &&
        preco.data_vencimento <= String(ano.data_fim).slice(0, 10);
}

async function guardarPrecoPolo(client, itemId, anoLetivoId, preco) {
    await client.query(
        `INSERT INTO propinas_taxas_polos (propina_taxa_id, polo_id, ano_letivo_id, valor, data_vencimento)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (propina_taxa_id, polo_id, ano_letivo_id)
         WHERE ano_letivo_id IS NOT NULL
         DO UPDATE SET valor = EXCLUDED.valor,
                       data_vencimento = COALESCE(EXCLUDED.data_vencimento, propinas_taxas_polos.data_vencimento),
                       atualizado_em = CURRENT_TIMESTAMP`,
        [itemId, preco.polo_id, anoLetivoId, Number(preco.valor), preco.data_vencimento || null]
    );
}

async function validarNiveisDaEscola(client, escolaId, ids) {
    if (!validarNiveis(ids)) return false;
    if (!ids.length) return true;
    const result = await client.query(
        `SELECT nivel_id FROM escolas_niveis WHERE escola_id = $1 AND nivel_id = ANY($2::uuid[])`,
        [escolaId, ids]
    );
    return result.rowCount === ids.length;
}

function dataIsoValida(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function somarMeses(data, meses) {
    const original = new Date(`${data}T00:00:00Z`);
    const dia = original.getUTCDate();
    original.setUTCDate(1);
    original.setUTCMonth(original.getUTCMonth() + meses);
    const ultimoDia = new Date(Date.UTC(original.getUTCFullYear(), original.getUTCMonth() + 1, 0)).getUTCDate();
    original.setUTCDate(Math.min(dia, ultimoDia));
    return original.toISOString().slice(0, 10);
}

function periodosVencidos(item, inicioObrigacao, fimAno, dataLimite) {
    const periodicidade = String(item.periodicidade || '').trim().toLowerCase();
    const passo = periodicidade === 'mensal' ? 1 : periodicidade === 'trimestral' ? 3 : 12;
    const datas = [];
    const dataBase = String(item.data_vencimento || '');
    if (!dataIsoValida(dataBase)) return datas;
    let primeiraParcela = 0;
    if (periodicidade !== 'unica') {
        const base = new Date(`${dataBase}T00:00:00Z`);
        const inicio = new Date(`${inicioObrigacao}T00:00:00Z`);
        const mesesAteInicio = (inicio.getUTCFullYear() - base.getUTCFullYear()) * 12 +
            inicio.getUTCMonth() - base.getUTCMonth();
        primeiraParcela = Math.max(0, Math.floor(mesesAteInicio / passo));
    }
    for (let parcela = primeiraParcela; ; parcela += 1) {
        const vencimento = somarMeses(dataBase, parcela * passo);
        if (vencimento > fimAno || vencimento > dataLimite) break;
        if (vencimento < inicioObrigacao && periodicidade !== 'unica') continue;
        datas.push(vencimento);
        if (periodicidade === 'unica') break;
    }
    return datas;
}

router.get('/caixa/estado', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem autorização para consultar o estado do caixa.' });
        }

        const resultado = await db.query(
            `SELECT id, acao, evento_em, to_char(evento_em, 'HH24:MI') AS hora_evento,
                    total_entradas, total_saidas
             FROM tesouraria_caixa_eventos
             WHERE escola_id = $1 AND evento_em::date = CURRENT_DATE
             ORDER BY evento_em, id`,
            [escolaId]
        );
        const eventos = resultado.rows;
        const ultimaAbertura = [...eventos].reverse().find((evento) => evento.acao === 'abertura');
        const ultimoFecho = [...eventos].reverse().find((evento) => evento.acao === 'fecho');
        const ultimoEvento = eventos[eventos.length - 1];

        return res.json({
            success: true,
            dados: {
                estado: ultimoEvento?.acao === 'abertura' ? 'aberto' : 'fechado',
                aberto_em: ultimaAbertura?.evento_em || null,
                fechado_em: ultimoFecho?.evento_em || null,
                aberto_hora: ultimaAbertura?.hora_evento || null,
                fechado_hora: ultimoFecho?.hora_evento || null,
                total_entradas: Number(ultimoEvento?.total_entradas || 0),
                total_saidas: Number(ultimoEvento?.total_saidas || 0),
                saldo_liquido: Number(ultimoEvento?.total_entradas || 0) - Number(ultimoEvento?.total_saidas || 0)
            }
        });
    } catch (error) {
        console.error('Erro ao consultar o estado do caixa:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível consultar o estado do caixa.' });
    }
});

router.post('/caixa/estado', verificarAutenticacao, async (req, res) => {
    let client;
    let transacaoAberta = false;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const acao = req.body?.acao;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem autorização para abrir ou fechar o caixa.' });
        }
        if (!['abertura', 'fecho'].includes(acao)) {
            return res.status(400).json({ success: false, message: 'A ação deve ser abertura ou fecho.' });
        }

        client = await db.connect();
        await client.query('BEGIN');
        transacaoAberta = true;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tesouraria-caixa:${escolaId}`]);

        const ultimoEventoResult = await client.query(
            `SELECT acao FROM tesouraria_caixa_eventos
             WHERE escola_id = $1 AND evento_em::date = CURRENT_DATE
             ORDER BY evento_em DESC, id DESC
             LIMIT 1`,
            [escolaId]
        );
        const caixaAberto = ultimoEventoResult.rows[0]?.acao === 'abertura';
        if ((acao === 'abertura' && caixaAberto) || (acao === 'fecho' && !caixaAberto)) {
            await client.query('ROLLBACK');
            transacaoAberta = false;
            return res.status(409).json({
                success: false,
                message: caixaAberto ? 'O caixa já está aberto.' : 'O caixa já está fechado. Abra-o antes de fechar.'
            });
        }

        const totaisResult = await client.query(
            `SELECT
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_saidas
             FROM tesouraria_movimentos
             WHERE escola_id = $1 AND data_movimento = CURRENT_DATE`,
            [escolaId]
        );
        const totalEntradas = Number(totaisResult.rows[0]?.total_entradas || 0);
        const totalSaidas = Number(totaisResult.rows[0]?.total_saidas || 0);
        const eventoResult = await client.query(
            `INSERT INTO tesouraria_caixa_eventos
                (escola_id, acao, total_entradas, total_saidas, registado_por)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, acao, evento_em, to_char(evento_em, 'HH24:MI') AS hora_evento,
                       total_entradas, total_saidas`,
            [escolaId, acao, totalEntradas, totalSaidas, req.user?.id || null]
        );
        const evento = eventoResult.rows[0];
        const saldoLiquido = totalEntradas - totalSaidas;
        const acaoLabel = acao === 'abertura' ? 'aberto' : 'fechado';
        const titulo = acao === 'abertura' ? 'Caixa aberto' : 'Caixa fechado';
        const mensagem = `Caixa ${acaoLabel} às ${evento.hora_evento}. Entradas: ${formatarMontanteNotificacao(totalEntradas)} CFA; saídas: ${formatarMontanteNotificacao(totalSaidas)} CFA; saldo: ${formatarMontanteNotificacao(saldoLiquido)} CFA.`;

        await client.query(
            `INSERT INTO platform_notifications
                (escola_id, categoria, titulo, mensagem, autor_id, destinatarios)
             VALUES ($1, 'tesouraria_caixa', $2, $3, $4, ARRAY['direcao']::text[])`,
            [escolaId, titulo, mensagem, req.user?.id || null]
        );
        await client.query('COMMIT');
        transacaoAberta = false;

        return res.status(201).json({
            success: true,
            message: titulo,
            dados: {
                ...evento,
                estado: acao === 'abertura' ? 'aberto' : 'fechado',
                saldo_liquido: saldoLiquido
            }
        });
    } catch (error) {
        if (client && transacaoAberta) {
            await client.query('ROLLBACK').catch((rollbackError) => {
                console.error('Erro ao reverter a operação do caixa:', rollbackError);
            });
        }
        console.error('Erro ao alterar o estado do caixa:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível alterar o estado do caixa.' });
    } finally {
        client?.release();
    }
});

router.get('/movimentos', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        const [resultado, totais] = await Promise.all([
            db.query(
                `SELECT tm.id, tm.ano_letivo_id, tm.polo_id, tm.tipo, tm.categoria, tm.destinatario,
                    tm.descricao, tm.metodo, tm.referencia, tm.valor,
                    tm.data_movimento::text AS data_movimento, tm.observacoes, tm.criado_em,
                    al.ano_nome, p.nome AS polo_nome
             FROM tesouraria_movimentos tm
             LEFT JOIN anos_letivos al ON al.id = tm.ano_letivo_id
             LEFT JOIN polos_escola p ON p.id = tm.polo_id AND p.escola_id = tm.escola_id
             WHERE tm.escola_id = $1 AND tm.data_movimento = CURRENT_DATE
                 ORDER BY tm.data_movimento DESC, tm.criado_em DESC`,
                [escolaId]
            ),
            db.query(
                `SELECT
                   CURRENT_DATE::text AS data_hoje,
                   COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
                    COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_saidas,
                    COUNT(*)::int AS quantidade,
                    COUNT(*) FILTER (WHERE tipo = 'entrada')::int AS quantidade_entradas,
                    COUNT(*) FILTER (WHERE tipo = 'saida')::int AS quantidade_saidas
                 FROM tesouraria_movimentos
                 WHERE escola_id = $1 AND data_movimento = CURRENT_DATE`,
                [escolaId]
            )
        ]);
        const totalEntradas = Number(totais.rows[0]?.total_entradas || 0);
        const totalSaidas = Number(totais.rows[0]?.total_saidas || 0);
        return res.json({
            success: true,
            dados: resultado.rows,
            resumo: {
                data_hoje: totais.rows[0]?.data_hoje,
                total_entradas: totalEntradas,
                total_saidas: totalSaidas,
                saldo_liquido: totalEntradas - totalSaidas,
                quantidade: Number(totais.rows[0]?.quantidade || 0),
                quantidade_entradas: Number(totais.rows[0]?.quantidade_entradas || 0),
                quantidade_saidas: Number(totais.rows[0]?.quantidade_saidas || 0)
            }
        });
    } catch (error) {
        console.error('Erro ao listar movimentos da tesouraria:', error);
        return res.status(500).json({ success: false, message: 'Erro ao carregar movimentos da tesouraria.' });
    }
});

router.post('/movimentos', verificarAutenticacao, async (req, res) => {
    let client;
    let transacaoAberta = false;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem autorização para registar movimentos da tesouraria.' });
        }

        const {
            tipo, categoria, destinatario, descricao, metodo, referencia, valor,
            data_movimento: dataMovimento, ano_letivo_id: anoLetivoId,
            polo_id: poloId, observacoes
        } = req.body || {};
        const valorNumerico = Number(valor);
        if (!['entrada', 'saida'].includes(tipo) ||
            (categoria != null && (typeof categoria !== 'string' || categoria.trim().length > 80)) ||
            typeof descricao !== 'string' || !descricao.trim() || descricao.trim().length > 160 ||
            typeof metodo !== 'string' || !metodo.trim() || metodo.trim().length > 40 ||
            !Number.isFinite(valorNumerico) || valorNumerico <= 0 || valorNumerico > 999999999999.99 ||
            !dataIsoValida(dataMovimento) ||
            (referencia != null && (typeof referencia !== 'string' || referencia.trim().length > 80)) ||
            (destinatario != null && (typeof destinatario !== 'string' || destinatario.trim().length > 120)) ||
            (observacoes != null && (typeof observacoes !== 'string' || observacoes.trim().length > 500)) ||
            (anoLetivoId != null && !UUID_PATTERN.test(anoLetivoId)) ||
            (poloId != null && !UUID_PATTERN.test(poloId))) {
            return res.status(400).json({ success: false, message: 'Verifique o tipo, descrição, método, valor e data do movimento.' });
        }
        const dataHoje = await db.query(`SELECT CURRENT_DATE::text AS data`);
        if (dataMovimento !== dataHoje.rows[0]?.data) {
            return res.status(400).json({ success: false, message: 'Só é possível registar movimentos com a data de hoje.' });
        }
        if (anoLetivoId) {
            const ano = await db.query(
                `SELECT 1 FROM escola_anos_letivos WHERE escola_id = $1 AND ano_letivo_id = $2`,
                [escolaId, anoLetivoId]
            );
            if (!ano.rowCount) {
                return res.status(400).json({ success: false, message: 'O ano letivo não está associado a esta escola.' });
            }
        }
        if (poloId) {
            const polo = await db.query(
                `SELECT 1 FROM polos_escola WHERE escola_id = $1 AND id = $2 AND ativo = true`,
                [escolaId, poloId]
            );
            if (!polo.rowCount) {
                return res.status(400).json({ success: false, message: 'O polo não está ativo ou não pertence a esta escola.' });
            }
        }

        const codigo = referencia?.trim() || (metodo === 'Mao'
            ? `REC-MAO-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`
            : `${tipo === 'entrada' ? 'ENT' : 'SAI'}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
        client = await db.connect();
        await client.query('BEGIN');
        transacaoAberta = true;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tesouraria-caixa:${escolaId}`]);
        const ultimoEvento = await client.query(
            `SELECT acao FROM tesouraria_caixa_eventos
             WHERE escola_id = $1 AND evento_em::date = CURRENT_DATE
             ORDER BY evento_em DESC, id DESC
             LIMIT 1`,
            [escolaId]
        );
        if (ultimoEvento.rows[0]?.acao !== 'abertura') {
            await client.query('ROLLBACK');
            transacaoAberta = false;
            return res.status(409).json({ success: false, message: 'O caixa está fechado. Abra-o antes de registar um movimento.' });
        }

        const resultado = await client.query(
            `INSERT INTO tesouraria_movimentos (
                escola_id, ano_letivo_id, polo_id, tipo, categoria, destinatario, descricao,
                metodo, referencia, valor, data_movimento, observacoes, registado_por
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING id, ano_letivo_id, polo_id, tipo, categoria, destinatario, descricao,
                       metodo, referencia, valor, data_movimento::text AS data_movimento,
                       observacoes, criado_em`,
            [
                escolaId, anoLetivoId || null, poloId || null, tipo, categoria?.trim() || 'Geral',
                destinatario?.trim() || 'Não especificado', descricao.trim(),
                metodo, codigo, valorNumerico, dataMovimento,
                observacoes?.trim() || null, req.user?.id || null
            ]
        );
        await client.query('COMMIT');
        transacaoAberta = false;
        return res.status(201).json({ success: true, message: 'Movimento registado com sucesso.', dados: resultado.rows[0] });
    } catch (error) {
        if (client && transacaoAberta) {
            await client.query('ROLLBACK').catch((rollbackError) => {
                console.error('Erro ao reverter o registo do movimento:', rollbackError);
            });
        }
        console.error('Erro ao registar movimento da tesouraria:', error);
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: 'Esta referência já está registada. Tente novamente.' });
        }
        return res.status(500).json({ success: false, message: 'Erro ao registar o movimento da tesouraria.' });
    } finally {
        client?.release();
    }
});

router.get('/dashboard', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

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
        const anoId = req.query.ano_letivo_id || anosResult.rows.find((ano) => ano.ativo)?.id || anosResult.rows[0]?.id || null;
        if (anoId && !UUID_PATTERN.test(anoId)) {
            return res.status(400).json({ success: false, message: 'Ano letivo inválido.' });
        }
        const ano = anosResult.rows.find((item) => item.id === anoId) || null;
        if (anoId && !ano) {
            return res.status(404).json({ success: false, message: 'O ano letivo não está associado a esta escola.' });
        }

        const intervaloValido = Boolean(ano?.data_inicio && ano?.data_fim && ano.data_inicio <= ano.data_fim);
        const [kpis, polos, pagamentos, atividades, escola, movimentosTotais, movimentos, eventosCaixa, taloesUsados] = await Promise.all([
            db.query(
                `SELECT
                    COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado = 'aprovado'), 0) AS total_arrecadado,
                    COALESCE(SUM(tp.valor) FILTER (WHERE tp.estado IN ('flagged', 'pendente_aprovacao')), 0) AS total_pendentes,
                    COUNT(*) FILTER (WHERE tp.estado IN ('flagged', 'pendente_aprovacao'))::int AS pendentes_qtd
                 FROM tesouraria_pagamentos tp
                 LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 WHERE tp.escola_id = $1
                   AND (
                     ($2::uuid IS NOT NULL AND COALESCE(tp.ano_letivo_id, m.ano_letivo_id, t.ano_letivo_id) = $2)
                     OR ($2::uuid IS NOT NULL AND EXISTS (
                       SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                       WHERE alocacao.pagamento_id = tp.id AND alocacao.ano_letivo_id = $2
                     ))
                     OR ($3::boolean AND tp.matricula_id IS NULL AND tp.ano_letivo_id IS NULL
                         AND tp.data_pagamento BETWEEN $4::date AND $5::date)
                   )
                   AND ($6::boolean OR m.id IS NOT NULL)`,
                [escolaId, anoId, intervaloValido, ano?.data_inicio || null, ano?.data_fim || null, Boolean(anoId)]
            ),
            db.query(
                `WITH registos_por_polo AS (
                   SELECT alocacao.escola_id, alocacao.ano_letivo_id, alocacao.polo_id,
                          alocacao.valor, pagamento.estado
                   FROM tesouraria_pagamentos_alocacoes alocacao
                   JOIN tesouraria_pagamentos pagamento
                     ON pagamento.id = alocacao.pagamento_id
                    AND pagamento.escola_id = alocacao.escola_id
                   WHERE alocacao.escola_id = $1 AND alocacao.pagamento_id IS NOT NULL

                   UNION ALL

                   SELECT pagamento.escola_id,
                          COALESCE(pagamento.ano_letivo_id, matricula.ano_letivo_id, turma.ano_letivo_id),
                          COALESCE(pagamento.polo_id, matricula.polo_id, turma.polo_id),
                          pagamento.valor, pagamento.estado
                   FROM tesouraria_pagamentos pagamento
                   LEFT JOIN matriculas matricula
                     ON matricula.id = pagamento.matricula_id AND matricula.escola_id = pagamento.escola_id
                   LEFT JOIN turmas turma
                     ON turma.id = matricula.turma_id AND turma.escola_id = matricula.escola_id
                   WHERE pagamento.escola_id = $1
                     AND NOT EXISTS (
                       SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                       WHERE alocacao.pagamento_id = pagamento.id
                     )

                   UNION ALL

                   SELECT alocacao.escola_id, alocacao.ano_letivo_id, alocacao.polo_id,
                          alocacao.valor, 'aprovado'::text
                   FROM tesouraria_pagamentos_alocacoes alocacao
                   JOIN tesouraria_movimentos movimento
                     ON movimento.id = alocacao.movimento_id
                    AND movimento.escola_id = alocacao.escola_id
                   WHERE alocacao.escola_id = $1 AND alocacao.movimento_id IS NOT NULL
                     AND movimento.tipo = 'entrada'

                   UNION ALL

                   SELECT movimento.escola_id, movimento.ano_letivo_id, movimento.polo_id,
                          movimento.valor, 'aprovado'::text
                   FROM tesouraria_movimentos movimento
                   WHERE movimento.escola_id = $1 AND movimento.tipo = 'entrada'
                     AND NOT EXISTS (
                       SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                       WHERE alocacao.movimento_id = movimento.id
                     )
                 )
                 SELECT polo.id, polo.nome,
                        COALESCE(SUM(registo.valor) FILTER (WHERE registo.estado = 'aprovado'), 0) AS receita,
                        COALESCE(SUM(registo.valor) FILTER (WHERE registo.estado IN ('flagged', 'pendente_aprovacao')), 0) AS pendente
                 FROM polos_escola polo
                 LEFT JOIN registos_por_polo registo
                   ON registo.escola_id = polo.escola_id AND registo.polo_id = polo.id
                  AND ($2::uuid IS NULL OR registo.ano_letivo_id = $2)
                 WHERE polo.escola_id = $1 AND polo.ativo = true
                 GROUP BY polo.id, polo.nome
                 ORDER BY polo.nome`,
                [escolaId, anoId]
            ),
            db.query(
                `SELECT tp.id, tp.referencia_banco, tp.codigo_talao, tp.tipo_registo, tp.nome_candidato,
                        tp.valor, tp.banco_origem, tp.estado, tp.criado_em,
                        pt.nome AS item_nome,
                        COALESCE(tp.classe, t.classe) AS classe,
                        COALESCE(u.nome, '') AS aluno_nome,
                        COALESCE(a.apelido, '') AS aluno_apelido
                 FROM tesouraria_pagamentos tp
                 LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
                 LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 LEFT JOIN alunos a ON a.id = COALESCE(m.aluno_id, tp.aluno_id)
                 LEFT JOIN utilizadores u ON u.id = a.utilizador_id
                 WHERE tp.escola_id = $1
                   AND (
                    ($2::uuid IS NOT NULL AND COALESCE(tp.ano_letivo_id, m.ano_letivo_id, t.ano_letivo_id) = $2)
                    OR ($2::uuid IS NOT NULL AND EXISTS (
                      SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                      WHERE alocacao.pagamento_id = tp.id AND alocacao.ano_letivo_id = $2
                    ))
                    OR ($3::boolean AND tp.matricula_id IS NULL AND tp.ano_letivo_id IS NULL
                        AND tp.data_pagamento BETWEEN $4::date AND $5::date)
                   )
                   AND ($6::boolean OR m.id IS NOT NULL)
                 ORDER BY tp.criado_em DESC NULLS LAST
                 LIMIT 8`,
                [escolaId, anoId, intervaloValido, ano?.data_inicio || null, ano?.data_fim || null, Boolean(anoId)]
            ),
            db.query(
                `SELECT tp.data_pagamento::text AS data, COUNT(*)::int AS quantidade
                 FROM tesouraria_pagamentos tp
                 LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 WHERE tp.escola_id = $1
                   AND (
                     ($2::uuid IS NOT NULL AND COALESCE(tp.ano_letivo_id, m.ano_letivo_id, t.ano_letivo_id) = $2)
                     OR ($2::uuid IS NOT NULL AND EXISTS (
                       SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                       WHERE alocacao.pagamento_id = tp.id AND alocacao.ano_letivo_id = $2
                     ))
                     OR ($3::boolean AND tp.matricula_id IS NULL AND tp.ano_letivo_id IS NULL
                         AND tp.data_pagamento BETWEEN $4::date AND $5::date)
                   )
                   AND ($6::boolean OR m.id IS NOT NULL)
                 GROUP BY tp.data_pagamento
                 ORDER BY tp.data_pagamento`,
                [escolaId, anoId, intervaloValido, ano?.data_inicio || null, ano?.data_fim || null, Boolean(anoId)]
            ),
            db.query(`SELECT nome FROM escolas WHERE id = $1`, [escolaId]),
            db.query(
                `SELECT
                    COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
                    COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_saidas
                 FROM tesouraria_movimentos
                 WHERE escola_id = $1 AND ($2::uuid IS NULL OR ano_letivo_id = $2)`,
                [escolaId, anoId]
            ),
            db.query(
                `SELECT id, tipo, categoria, destinatario, descricao, metodo, referencia,
                        valor, data_movimento::text AS data_movimento, observacoes, criado_em
                 FROM tesouraria_movimentos
                 WHERE escola_id = $1 AND ($2::uuid IS NULL OR ano_letivo_id = $2)
                 ORDER BY data_movimento DESC, criado_em DESC
                 LIMIT 8`,
                [escolaId, anoId]
            ),
            db.query(
                `SELECT id, acao, evento_em, to_char(evento_em, 'HH24:MI') AS hora_evento,
                        total_entradas, total_saidas
                 FROM tesouraria_caixa_eventos
                 WHERE escola_id = $1 AND evento_em::date = CURRENT_DATE
                 ORDER BY evento_em, id`,
                [escolaId]
            ),
            db.query(
                `WITH taloes_usados AS (
                   SELECT alocacao.pagamento_id AS id, 'pagamento'::text AS origem,
                          COALESCE(NULLIF(BTRIM(pagamento.codigo_talao), ''), pagamento.referencia_banco, 'Talão') AS codigo_talao,
                          pagamento.referencia_banco, alocacao.criado_em,
                          alocacao.valor, alocacao.classe,
                          TRIM(CONCAT_WS(' ', aluno.nome, estudante.apelido)) AS nome_aluno,
                          registador.nome AS nome_secretaria,
                          item.nome AS item_nome
                   FROM tesouraria_pagamentos_alocacoes alocacao
                   JOIN tesouraria_pagamentos pagamento
                     ON pagamento.id = alocacao.pagamento_id
                    AND pagamento.escola_id = alocacao.escola_id
                   JOIN alunos estudante ON estudante.id = alocacao.aluno_id
                   JOIN utilizadores aluno ON aluno.id = estudante.utilizador_id
                   LEFT JOIN utilizadores registador ON registador.id = alocacao.registado_por
                   JOIN propinas_taxas item ON item.id = alocacao.propina_taxa_id
                   WHERE alocacao.escola_id = $1 AND alocacao.ano_letivo_id = $2
                     AND EXISTS (
                       SELECT 1
                       FROM associacoes_escola associacao
                       JOIN papeis_utilizador papel ON papel.associacao_id = associacao.id
                       WHERE associacao.escola_id = alocacao.escola_id
                         AND associacao.utilizador_id = alocacao.registado_por
                         AND associacao.status = 'ativo'
                         AND LOWER(BTRIM(papel.papel)) = 'secretaria'
                     )

                   UNION ALL

                   SELECT alocacao.movimento_id AS id, 'movimento_manual'::text AS origem,
                          movimento.referencia AS codigo_talao, movimento.referencia AS referencia_banco,
                          alocacao.criado_em, alocacao.valor, alocacao.classe,
                          TRIM(CONCAT_WS(' ', aluno.nome, estudante.apelido)) AS nome_aluno,
                          registador.nome AS nome_secretaria,
                          item.nome AS item_nome
                   FROM tesouraria_pagamentos_alocacoes alocacao
                   JOIN tesouraria_movimentos movimento
                     ON movimento.id = alocacao.movimento_id
                    AND movimento.escola_id = alocacao.escola_id
                    AND movimento.tipo = 'entrada'
                   JOIN alunos estudante ON estudante.id = alocacao.aluno_id
                   JOIN utilizadores aluno ON aluno.id = estudante.utilizador_id
                   LEFT JOIN utilizadores registador ON registador.id = alocacao.registado_por
                   JOIN propinas_taxas item ON item.id = alocacao.propina_taxa_id
                   WHERE alocacao.escola_id = $1 AND alocacao.ano_letivo_id = $2
                     AND EXISTS (
                       SELECT 1
                       FROM associacoes_escola associacao
                       JOIN papeis_utilizador papel ON papel.associacao_id = associacao.id
                       WHERE associacao.escola_id = alocacao.escola_id
                         AND associacao.utilizador_id = alocacao.registado_por
                         AND associacao.status = 'ativo'
                         AND LOWER(BTRIM(papel.papel)) = 'secretaria'
                     )
                 ),
                 agrupados AS (
                   SELECT id, origem, codigo_talao, referencia_banco,
                          MAX(criado_em) AS criado_em, classe, nome_aluno, nome_secretaria,
                          SUM(valor) AS valor_alocado,
                          STRING_AGG(DISTINCT item_nome, ', ' ORDER BY item_nome) AS itens
                   FROM taloes_usados
                   GROUP BY id, origem, codigo_talao, referencia_banco, classe,
                            nome_aluno, nome_secretaria
                 )
                 SELECT agrupados.*, COUNT(*) OVER()::int AS total_taloes
                 FROM agrupados
                 ORDER BY criado_em DESC
                 LIMIT 8`,
                [escolaId, anoId]
            )
        ]);
        const eventosDoCaixa = eventosCaixa.rows;
        const ultimoEventoCaixa = eventosDoCaixa[eventosDoCaixa.length - 1];
        const ultimaAberturaCaixa = [...eventosDoCaixa].reverse().find((evento) => evento.acao === 'abertura');
        const ultimoFechoCaixa = [...eventosDoCaixa].reverse().find((evento) => evento.acao === 'fecho');
        const alunos = anoId
            ? await db.query(
                `SELECT COUNT(*)::int AS total
                 FROM matriculas
                 WHERE escola_id = $1 AND ano_letivo_id = $2 AND estado = 'ativa'`,
                [escolaId, anoId]
            )
            : { rows: [{ total: 0 }] };
        const totalPolos = await db.query(
            `SELECT COUNT(*)::int AS total FROM polos_escola WHERE escola_id = $1 AND ativo = true`,
            [escolaId]
        );

        return res.json({
            success: true,
            dados: {
                escola_nome: escola.rows[0]?.nome || 'Tesouraria',
                anos_letivos: anosResult.rows,
                ano_letivo: ano,
                intervalo_valido: intervaloValido,
                total_arrecadado: Number(kpis.rows[0]?.total_arrecadado || 0),
                total_entradas: Number(kpis.rows[0]?.total_arrecadado || 0) + Number(movimentosTotais.rows[0]?.total_entradas || 0),
                total_saidas: Number(movimentosTotais.rows[0]?.total_saidas || 0),
                saldo_liquido: Number(kpis.rows[0]?.total_arrecadado || 0) +
                    Number(movimentosTotais.rows[0]?.total_entradas || 0) -
                    Number(movimentosTotais.rows[0]?.total_saidas || 0),
                caixa: {
                    estado: ultimoEventoCaixa?.acao === 'abertura' ? 'aberto' : 'fechado',
                    aberto_em: ultimaAberturaCaixa?.evento_em || null,
                    fechado_em: ultimoFechoCaixa?.evento_em || null,
                    aberto_hora: ultimaAberturaCaixa?.hora_evento || null,
                    fechado_hora: ultimoFechoCaixa?.hora_evento || null,
                    total_entradas: Number(ultimoEventoCaixa?.total_entradas || 0),
                    total_saidas: Number(ultimoEventoCaixa?.total_saidas || 0),
                    saldo_liquido: Number(ultimoEventoCaixa?.total_entradas || 0) -
                        Number(ultimoEventoCaixa?.total_saidas || 0)
                },
                total_pendentes: Number(kpis.rows[0]?.total_pendentes || 0),
                pendentes_qtd: Number(kpis.rows[0]?.pendentes_qtd || 0),
                total_polos: Number(totalPolos.rows[0]?.total || 0),
                total_alunos: Number(alunos.rows[0]?.total || 0),
                polos: polos.rows.map((item) => ({
                    name: item.nome,
                    receita: Number(item.receita || 0),
                    pendente: Number(item.pendente || 0)
                })),
                pagamentos: pagamentos.rows,
                taloes_usados: taloesUsados.rows,
                total_taloes_usados: Number(taloesUsados.rows[0]?.total_taloes || 0),
                movimentos: movimentos.rows,
                atividades: atividades.rows
            }
        });
    } catch (error) {
        console.error('Erro ao carregar dashboard da tesouraria:', error);
        return res.status(500).json({ success: false, message: 'Erro ao carregar dados do dashboard da tesouraria.' });
    }
});

// ============================================================
// ROTA: LISTAR ITENS DE PAGAMENTO DO BANCO DE DADOS
// GET /api/v1/tesouraria/propinas-taxas
// ============================================================
router.get('/propinas-taxas', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const resultado = await db.query(
            `SELECT pt.id, pt.nome, pt.valor, pt.tipo, pt.periodicidade,
                    pt.obrigatoria AS obrigatorio,
                    COALESCE(ARRAY_AGG(ptn.nivel_id) FILTER (WHERE ptn.nivel_id IS NOT NULL), ARRAY[]::uuid[]) AS nivel_ids,
                    COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'classe', ptc.classe,
                            'ano_letivo_id', ptc.ano_letivo_id,
                            'ano_nome', al.ano_nome,
                            'valor', ptc.valor,
                            'data_vencimento', ptc.data_vencimento
                        ) ORDER BY al.ano_nome DESC NULLS LAST, ptc.classe)
                        FROM propinas_taxas_classes ptc
                        LEFT JOIN anos_letivos al ON al.id = ptc.ano_letivo_id
                        WHERE ptc.propina_taxa_id = pt.id AND ptc.escola_id = pt.escola_id
                    ), '[]'::jsonb) AS classe_precos,
                    COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'polo_id', ptp.polo_id,
                            'polo_nome', p.nome,
                            'ano_letivo_id', ptp.ano_letivo_id,
                            'ano_nome', al.ano_nome,
                            'valor', ptp.valor,
                            'data_vencimento', ptp.data_vencimento
                        ) ORDER BY al.ano_nome DESC NULLS LAST, p.nome)
                        FROM propinas_taxas_polos ptp
                        JOIN polos_escola p ON p.id = ptp.polo_id
                        LEFT JOIN anos_letivos al ON al.id = ptp.ano_letivo_id
                        WHERE ptp.propina_taxa_id = pt.id AND p.escola_id = pt.escola_id
                    ), '[]'::jsonb) AS polo_precos
             FROM propinas_taxas pt
             LEFT JOIN propinas_taxas_niveis ptn ON ptn.propina_taxa_id = pt.id
             WHERE pt.escola_id = $1 AND pt.ativa = true
             GROUP BY pt.id
             ORDER BY pt.nome ASC`,
            [escolaId]
        );

        return res.json({ 
            success: true, 
            dados: resultado.rows 
        });

    } catch (error) {
        console.error("Erro ao carregar itens de pagamento da BD:", error);
        return res.status(500).json({ 
            success: false,
            message: error.code === '42P01'
                ? 'A estrutura de preços por polo ainda não foi instalada. Aplique as migrações da base de dados.'
                : 'Erro ao carregar itens de pagamento. Verifique a ligação e a estrutura da base de dados.'
        });
    }
});

router.post('/propinas-taxas', verificarAutenticacao, async (req, res) => {
    let client;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { nome, valor, tipo, ano_letivo_id, periodicidade = 'mensal', obrigatorio = true, nivel_ids = [], polo_precos, classe_precos } = req.body || {};
        const valorNumerico = Number(valor);
        const temPrecoClasse = classe_precos !== undefined;

        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem permissão para alterar configurações de tesouraria.' });
        }
        if ((polo_precos !== undefined || temPrecoClasse) && !podeDefinirPrecosPorPolo(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Direção pode definir preços por classe.' });
        }
        if (tipo === 'matricula' && !podeDefinirPrecosPorPolo(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Direção pode configurar a taxa de matrícula.' });
        }
        if (tipo !== 'matricula' && polo_precos === undefined && !temPrecoClasse &&
            (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 100)) {
            return res.status(400).json({ success: false, message: 'O nome do item é obrigatório e deve ter até 100 caracteres.' });
        }
        if ((tipo === 'matricula' || polo_precos !== undefined || temPrecoClasse) && !UUID_PATTERN.test(ano_letivo_id || '')) {
            return res.status(400).json({ success: false, message: 'Selecione o ano letivo para configurar o preço do item.' });
        }
        if (!Number.isFinite(valorNumerico) || valorNumerico < 0 ||
            tipo !== 'matricula' && (polo_precos !== undefined || temPrecoClasse) && valorNumerico <= 0 ||
            !TIPOS_PAGAMENTO.includes(tipo) ||
            !PERIODICIDADES.includes(periodicidade) ||
            typeof obrigatorio !== 'boolean' || !validarNiveis(nivel_ids)) {
            return res.status(400).json({ success: false, message: 'Indique preço, categoria, periodicidade, vencimento, níveis e obrigatoriedade válidos.' });
        }

        client = await db.connect();
        await client.query('BEGIN');
        let nomeDoItem = nome?.trim() || '';
        if (temPrecoClasse) {
            const ano = await client.query(
                `SELECT al.ano_nome
                 FROM escola_anos_letivos eal
                 JOIN anos_letivos al ON al.id = eal.ano_letivo_id
                 WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2`,
                [escolaId, ano_letivo_id]
            );
            const preco = precosClasseValidos(classe_precos) ? classe_precos[0] : null;
            if (!ano.rowCount || !preco ||
                !await validarPrecoIndividualClasse(client, escolaId, ano_letivo_id, preco)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Selecione uma classe existente, o ano letivo e um preço válido.' });
            }
            if (Math.round(valorNumerico * 100) !== Math.round(Number(preco.valor) * 100)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'O preço geral deve corresponder ao preço definido para a classe.' });
            }
            const categorias = {
                propina: 'Propina',
                matricula: 'Matrícula',
                inscricao: 'Inscrição',
                exame: 'Exame',
                transporte: 'Transporte',
                alimentacao: 'Alimentação',
                outro: 'Outro'
            };
            nomeDoItem = `${categorias[tipo] || tipo} · ${preco.classe.trim()} · ${ano.rows[0].ano_nome}`;
            if (nomeDoItem.length > 100) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'A classe ou o ano letivo produz um nome de item demasiado longo.' });
            }
        } else if (tipo === 'matricula' || polo_precos !== undefined) {
            const ano = await client.query(
                `SELECT al.ano_nome
                 FROM escola_anos_letivos eal
                 JOIN anos_letivos al ON al.id = eal.ano_letivo_id
                 WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2`,
                [escolaId, ano_letivo_id]
            );
            if (!ano.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'O ano letivo selecionado não pertence a esta escola.' });
            }
            const preco = Array.isArray(polo_precos) && polo_precos.length === 1 ? polo_precos[0] : null;
            if (!preco || !await validarPrecoIndividualPolo(client, escolaId, ano_letivo_id, preco)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Selecione um polo ativo e um preço válido para o ano letivo.' });
            }
            if (Math.round(valorNumerico * 100) !== Math.round(Number(preco.valor) * 100)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'O preço geral deve corresponder ao preço definido para o polo.' });
            }
            const polo = await client.query(
                `SELECT nome FROM polos_escola WHERE id = $1 AND escola_id = $2`,
                [preco.polo_id, escolaId]
            );
            const categorias = {
                propina: 'Propina',
                matricula: 'Matrícula',
                inscricao: 'Inscrição',
                exame: 'Exame',
                transporte: 'Transporte',
                alimentacao: 'Alimentação',
                outro: 'Outro'
            };
            nomeDoItem = `${categorias[tipo] || tipo} · ${polo.rows[0].nome} · ${ano.rows[0].ano_nome}`;
            if (nomeDoItem.length > 100) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'O polo ou ano letivo produz um nome de item demasiado longo.' });
            }
        }
        if (!await validarNiveisDaEscola(client, escolaId, nivel_ids)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Um ou mais níveis não pertencem a esta escola.' });
        }
        const itemExistente = tipo === 'matricula' || polo_precos !== undefined || temPrecoClasse
            ? await client.query(
                `SELECT id FROM propinas_taxas
                 WHERE escola_id = $1 AND nome = $2 AND tipo = $3
                 FOR UPDATE`,
                [escolaId, nomeDoItem, tipo]
            )
            : { rowCount: 0 };
        const resultado = itemExistente.rowCount
            ? await client.query(
                `UPDATE propinas_taxas
                 SET valor = $1, periodicidade = $2, obrigatoria = $3,
                     ativa = true, atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = $5
                 RETURNING id, nome, valor, tipo, periodicidade, obrigatoria AS obrigatorio`,
                [valorNumerico, periodicidade, obrigatorio, itemExistente.rows[0].id]
            )
            : await client.query(
                `INSERT INTO propinas_taxas (escola_id, nome, valor, tipo, periodicidade, obrigatoria, ativa)
                 VALUES ($1, $2, $3, $4, $5, $6, true)
                 RETURNING id, nome, valor, tipo, periodicidade, obrigatoria AS obrigatorio`,
                [escolaId, nomeDoItem, valorNumerico, tipo, periodicidade, obrigatorio]
            );
        if (itemExistente.rowCount) {
            await client.query('DELETE FROM propinas_taxas_niveis WHERE propina_taxa_id = $1', [resultado.rows[0].id]);
        }
        if (nivel_ids.length) {
            await client.query(
                `INSERT INTO propinas_taxas_niveis (propina_taxa_id, nivel_id)
                 SELECT $1, unnest($2::uuid[])`,
                [resultado.rows[0].id, nivel_ids]
            );
        }
        if (temPrecoClasse) {
            const preco = precosClasseValidos(classe_precos) ? classe_precos[0] : null;
            if (!preco || !await validarPrecoIndividualClasse(client, escolaId, ano_letivo_id, preco)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Selecione uma classe existente e defina um preço válido para este item.' });
            }
            await guardarPrecoClasse(client, resultado.rows[0].id, escolaId, ano_letivo_id, preco);
        } else if (tipo === 'matricula' || polo_precos !== undefined) {
            const preco = Array.isArray(polo_precos) && polo_precos.length === 1 ? polo_precos[0] : null;
            if (!podeDefinirPrecosPorPolo(req) || !preco ||
                !await validarPrecoIndividualPolo(client, escolaId, ano_letivo_id, preco)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Selecione um polo ativo e defina um preço válido para este item.' });
            }
            await guardarPrecoPolo(client, resultado.rows[0].id, ano_letivo_id, preco);
        }
        await client.query('COMMIT');
        return res.status(201).json({
            success: true,
            message: 'Item de pagamento criado com sucesso.',
            data: { ...resultado.rows[0], nivel_ids, classe_precos: temPrecoClasse ? classe_precos : [] }
        });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Erro ao criar item de pagamento:', error);
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: 'Já existe um item com esse nome nesta escola.' });
        }
        return res.status(500).json({ success: false, message: 'Erro ao criar o item de pagamento.' });
    } finally {
        client?.release();
    }
});

router.put('/propinas-taxas/:id', verificarAutenticacao, async (req, res) => {
    let client;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { id } = req.params;
        const {
            nome, valor, tipo, ano_letivo_id, periodicidade, obrigatorio, ativa,
            nivel_ids, polo_precos, classe_precos,
            origem_ano_letivo_id, origem_classe
        } = req.body || {};
        const valorNumerico = Number(valor);
        const temOrigemClasse = origem_ano_letivo_id !== undefined || origem_classe !== undefined;

        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem permissão para alterar configurações de tesouraria.' });
        }
        if ((polo_precos !== undefined || classe_precos !== undefined) && !podeDefinirPrecosPorPolo(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Direção pode definir preços por classe.' });
        }
        if (!UUID_PATTERN.test(id)) {
            return res.status(400).json({ success: false, message: 'Identificador do item inválido.' });
        }
        if (!Number.isFinite(valorNumerico) || valorNumerico < 0 || !TIPOS_PAGAMENTO.includes(tipo) ||
            nome !== undefined && (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 100) ||
            periodicidade !== undefined && !PERIODICIDADES.includes(periodicidade) ||
            obrigatorio !== undefined && typeof obrigatorio !== 'boolean' ||
            ativa !== undefined && typeof ativa !== 'boolean' ||
            ano_letivo_id !== undefined && !UUID_PATTERN.test(ano_letivo_id || '') ||
            temOrigemClasse && classe_precos === undefined ||
            temOrigemClasse && (
                !UUID_PATTERN.test(origem_ano_letivo_id || '') ||
                typeof origem_classe !== 'string' ||
                !origem_classe.trim() ||
                origem_classe.trim().length > 100
            ) ||
            nivel_ids !== undefined && !validarNiveis(nivel_ids)) {
            return res.status(400).json({ success: false, message: 'Indique preço, categoria, periodicidade, vencimento e níveis válidos.' });
        }

        client = await db.connect();
        await client.query('BEGIN');
        if (nivel_ids !== undefined && !await validarNiveisDaEscola(client, escolaId, nivel_ids)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Um ou mais níveis não pertencem a esta escola.' });
        }
        const resultado = await client.query(
            `UPDATE propinas_taxas
             SET nome = COALESCE($1, nome),
                 valor = $2,
                 tipo = $3,
                 periodicidade = COALESCE($4, periodicidade),
                 obrigatoria = COALESCE($5, obrigatoria),
                 ativa = COALESCE($6, ativa),
                 atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $7 AND escola_id = $8
             RETURNING id, nome, valor, tipo, periodicidade, obrigatoria AS obrigatorio, ativa`,
            [nome?.trim() || null, valorNumerico, tipo, periodicidade ?? null, obrigatorio ?? null, ativa ?? null, id, escolaId]
        );
        if (resultado.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Item de pagamento não encontrado.' });
        }
        if (nivel_ids !== undefined) {
            await client.query('DELETE FROM propinas_taxas_niveis WHERE propina_taxa_id = $1', [id]);
            if (nivel_ids.length) {
                await client.query(
                    `INSERT INTO propinas_taxas_niveis (propina_taxa_id, nivel_id)
                     SELECT $1, unnest($2::uuid[])`,
                    [id, nivel_ids]
                );
            }
        }
        if (classe_precos !== undefined) {
            const preco = precosClasseValidos(classe_precos) ? classe_precos[0] : null;
            if (!preco || !ano_letivo_id ||
                !await validarPrecoIndividualClasse(client, escolaId, ano_letivo_id, preco)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Indique o ano letivo, uma classe existente e o respetivo preço.' });
            }
            if (temOrigemClasse) {
                const origem = await client.query(
                    `SELECT classe, ano_letivo_id
                     FROM propinas_taxas_classes
                     WHERE propina_taxa_id = $1 AND escola_id = $2
                       AND LOWER(BTRIM(classe)) = LOWER(BTRIM($3))
                       AND ano_letivo_id = $4
                     FOR UPDATE`,
                    [id, escolaId, origem_classe, origem_ano_letivo_id]
                );
                if (!origem.rowCount) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ success: false, message: 'A configuração original da classe já não existe.' });
                }

                const mudouPerfil = String(origem.rows[0].ano_letivo_id) !== String(ano_letivo_id) ||
                    origem.rows[0].classe.trim().toLowerCase() !== preco.classe.trim().toLowerCase();
                if (mudouPerfil) {
                    const historico = await client.query(
                        `SELECT EXISTS (
                           SELECT 1 FROM tesouraria_pagamentos
                           WHERE propina_taxa_id = $1 AND escola_id = $2
                             AND LOWER(BTRIM(classe)) = LOWER(BTRIM($3))
                             AND ano_letivo_id = $4
                           UNION ALL
                           SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                           WHERE alocacao.propina_taxa_id = $1 AND alocacao.escola_id = $2
                             AND LOWER(BTRIM(COALESCE(alocacao.classe, (
                               SELECT turma.classe FROM matriculas matricula
                               JOIN turmas turma ON turma.id = matricula.turma_id
                               WHERE matricula.id = alocacao.matricula_id
                             )))) = LOWER(BTRIM($3))
                             AND alocacao.ano_letivo_id = $4
                         ) AS tem_historico`,
                        [id, escolaId, origem.rows[0].classe, origem.rows[0].ano_letivo_id]
                    );
                    if (historico.rows[0].tem_historico) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({
                            success: false,
                            message: 'Não é possível alterar o ano ou a classe desta configuração porque já existem pagamentos associados. O histórico financeiro foi preservado.'
                        });
                    }

                    const destino = await client.query(
                        `SELECT 1 FROM propinas_taxas_classes
                         WHERE propina_taxa_id = $1 AND escola_id = $2
                           AND LOWER(BTRIM(classe)) = LOWER(BTRIM($3))
                           AND ano_letivo_id = $4
                         FOR UPDATE`,
                        [id, escolaId, preco.classe, ano_letivo_id]
                    );
                    if (destino.rowCount) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({
                            success: false,
                            message: 'Já existe uma configuração para esta classe e ano letivo.'
                        });
                    }

                    await client.query(
                        `UPDATE propinas_taxas_classes
                         SET classe = $1, ano_letivo_id = $2, valor = $3,
                             data_vencimento = $4, atualizado_em = CURRENT_TIMESTAMP
                         WHERE propina_taxa_id = $5 AND escola_id = $6
                           AND LOWER(BTRIM(classe)) = LOWER(BTRIM($7))
                           AND ano_letivo_id = $8`,
                        [
                            preco.classe.trim(), ano_letivo_id, Number(preco.valor),
                            preco.data_vencimento, id, escolaId,
                            origem.rows[0].classe, origem.rows[0].ano_letivo_id
                        ]
                    );
                } else {
                    await guardarPrecoClasse(client, id, escolaId, ano_letivo_id, preco);
                }
            } else {
                await guardarPrecoClasse(client, id, escolaId, ano_letivo_id, preco);
            }
        } else if (polo_precos !== undefined) {
            const preco = Array.isArray(polo_precos) && polo_precos.length === 1 ? polo_precos[0] : null;
            if (!preco || !ano_letivo_id ||
                !await validarPrecoIndividualPolo(client, escolaId, ano_letivo_id, preco)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Indique o ano letivo, um polo ativo e o respetivo preço.' });
            }
            await guardarPrecoPolo(client, id, ano_letivo_id, preco);
        }
        await client.query('COMMIT');

        return res.json({
            success: true,
            message: 'Item de pagamento atualizado com sucesso.',
            data: { ...resultado.rows[0], nivel_ids: nivel_ids ?? [] }
        });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Erro ao atualizar item de pagamento:', error);
        return res.status(500).json({ success: false, message: 'Erro ao atualizar o item de pagamento.' });
    } finally {
        client?.release();
    }
});

router.delete('/propinas-taxas/:id', verificarAutenticacao, async (req, res) => {
    let client;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { id } = req.params;
        const { polo_id: poloId, ano_letivo_id: anoLetivoId } = req.query;
        const classe = typeof req.query.classe === 'string' ? req.query.classe.trim() : '';
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem permissão para remover itens de pagamento.' });
        }
        if (!UUID_PATTERN.test(id)) {
            return res.status(400).json({ success: false, message: 'Identificador do item inválido.' });
        }
        if ((poloId || anoLetivoId) &&
            (!UUID_PATTERN.test(poloId || '') || !UUID_PATTERN.test(anoLetivoId || ''))) {
            return res.status(400).json({ success: false, message: 'Indique um polo e um ano letivo válidos para remover esta configuração.' });
        }
        if ((classe || (!poloId && anoLetivoId)) &&
            (!classe || classe.length > 100 || !UUID_PATTERN.test(anoLetivoId || ''))) {
            return res.status(400).json({ success: false, message: 'Indique uma classe e um ano letivo válidos para remover esta configuração.' });
        }

        client = await db.connect();
        await client.query('BEGIN');
        const item = await client.query(
            `SELECT id FROM propinas_taxas
             WHERE id = $1 AND escola_id = $2
             FOR UPDATE`,
            [id, escolaId]
        );
        if (!item.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Item de pagamento não encontrado.' });
        }

        if (classe && anoLetivoId) {
            const configuracao = await client.query(
                `SELECT 1 FROM propinas_taxas_classes
                 WHERE propina_taxa_id = $1 AND escola_id = $2
                   AND LOWER(BTRIM(classe)) = LOWER(BTRIM($3))
                   AND ano_letivo_id = $4
                 FOR UPDATE`,
                [id, escolaId, classe, anoLetivoId]
            );
            if (!configuracao.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Configuração de preço da classe não encontrada.' });
            }
            const pagamento = await client.query(
                `SELECT EXISTS (
                   SELECT 1 FROM tesouraria_pagamentos tp
                   WHERE tp.propina_taxa_id = $1 AND tp.escola_id = $2
                     AND LOWER(BTRIM(tp.classe)) = LOWER(BTRIM($3))
                     AND tp.ano_letivo_id = $4
                   UNION ALL
                   SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                   WHERE alocacao.propina_taxa_id = $1 AND alocacao.escola_id = $2
                     AND LOWER(BTRIM(COALESCE(alocacao.classe, (
                       SELECT turma.classe FROM matriculas matricula
                       JOIN turmas turma ON turma.id = matricula.turma_id
                       WHERE matricula.id = alocacao.matricula_id
                     )))) = LOWER(BTRIM($3))
                     AND alocacao.ano_letivo_id = $4
                 ) AS tem_pagamentos`,
                [id, escolaId, classe, anoLetivoId]
            );
            if (pagamento.rows[0].tem_pagamentos) {
                 await client.query('ROLLBACK');
                 return res.status(409).json({
                     success: false,
                     message: 'Esta configuração já tem pagamentos registados e não pode ser removida sem comprometer o histórico.'
                 });
            }
            await client.query(
                 `DELETE FROM propinas_taxas_classes
                  WHERE propina_taxa_id = $1 AND escola_id = $2
                    AND LOWER(BTRIM(classe)) = LOWER(BTRIM($3))
                    AND ano_letivo_id = $4`,
                 [id, escolaId, classe, anoLetivoId]
            );
            const restantes = await client.query(
                 `SELECT EXISTS (
                    SELECT 1 FROM propinas_taxas_classes WHERE propina_taxa_id = $1 AND escola_id = $2
                  ) AS tem_configuracoes`,
                 [id, escolaId]
            );
            const historico = await client.query(
                 `SELECT EXISTS (
                    SELECT 1 FROM tesouraria_pagamentos WHERE propina_taxa_id = $1 AND escola_id = $2
                    UNION ALL
                    SELECT 1 FROM tesouraria_pagamentos_alocacoes WHERE propina_taxa_id = $1 AND escola_id = $2
                  ) AS tem_historico`,
                 [id, escolaId]
            );
            if (!restantes.rows[0].tem_configuracoes && historico.rows[0].tem_historico) {
                 await client.query(
                     `UPDATE propinas_taxas SET ativa = false, atualizado_em = CURRENT_TIMESTAMP
                      WHERE id = $1 AND escola_id = $2`,
                     [id, escolaId]
                 );
            } else if (!restantes.rows[0].tem_configuracoes) {
                 await client.query(`DELETE FROM propinas_taxas WHERE id = $1 AND escola_id = $2`, [id, escolaId]);
            }
            await client.query('COMMIT');
            return res.json({
                success: true,
                message: historico.rows[0].tem_historico && !restantes.rows[0].tem_configuracoes
                    ? 'Configuração removida e item desativado para preservar o histórico.'
                    : 'Configuração da classe apagada com sucesso.',
                data: {
                    id,
                    classe,
                    ano_letivo_id: anoLetivoId,
                    acao: historico.rows[0].tem_historico && !restantes.rows[0].tem_configuracoes ? 'anulado' : 'apagado'
                }
            });
        }

        if (poloId && anoLetivoId) {
            const configuracao = await client.query(
                `SELECT 1
                 FROM propinas_taxas_polos ptp
                 JOIN polos_escola p ON p.id = ptp.polo_id AND p.escola_id = $4
                 WHERE ptp.propina_taxa_id = $1 AND ptp.polo_id = $2 AND ptp.ano_letivo_id = $3
                 FOR UPDATE OF ptp`,
                [id, poloId, anoLetivoId, escolaId]
            );
            if (!configuracao.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Configuração de preço não encontrada.' });
            }

            const pagamentosConfiguracao = await client.query(
                `SELECT EXISTS (
                   SELECT 1
                   FROM tesouraria_pagamentos tp
                   LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
                   WHERE tp.propina_taxa_id = $1
                     AND tp.escola_id = $2
                     AND COALESCE(tp.polo_id, m.polo_id) = $3
                     AND COALESCE(tp.ano_letivo_id, m.ano_letivo_id) = $4
                 ) AS tem_pagamentos`,
                [id, escolaId, poloId, anoLetivoId]
            );
            await client.query(
                `DELETE FROM propinas_taxas_polos
                 WHERE propina_taxa_id = $1 AND polo_id = $2 AND ano_letivo_id = $3`,
                [id, poloId, anoLetivoId]
            );
            const restantes = await client.query(
                `SELECT EXISTS (
                   SELECT 1 FROM propinas_taxas_polos WHERE propina_taxa_id = $1
                 ) AS tem_configuracoes`,
                [id]
            );

            if (pagamentosConfiguracao.rows[0].tem_pagamentos && !restantes.rows[0].tem_configuracoes) {
                await client.query(
                    `UPDATE propinas_taxas
                     SET ativa = false, atualizado_em = CURRENT_TIMESTAMP
                     WHERE id = $1 AND escola_id = $2`,
                    [id, escolaId]
                );
            } else if (!pagamentosConfiguracao.rows[0].tem_pagamentos && !restantes.rows[0].tem_configuracoes) {
                await client.query(
                    `DELETE FROM propinas_taxas WHERE id = $1 AND escola_id = $2`,
                    [id, escolaId]
                );
            }

            await client.query('COMMIT');
            return res.json({
                success: true,
                message: pagamentosConfiguracao.rows[0].tem_pagamentos
                    ? 'Configuração anulada. O histórico de pagamentos foi preservado.'
                    : 'Configuração apagada com sucesso.',
                data: { id, polo_id: poloId, ano_letivo_id: anoLetivoId, acao: pagamentosConfiguracao.rows[0].tem_pagamentos ? 'anulado' : 'apagado' }
            });
        }

        const pagamentos = await client.query(
            `SELECT EXISTS (
               SELECT 1 FROM tesouraria_pagamentos
               WHERE propina_taxa_id = $1 AND escola_id = $2
             ) AS tem_pagamentos`,
            [id, escolaId]
        );
        if (pagamentos.rows[0].tem_pagamentos) {
            await client.query(
                `UPDATE propinas_taxas
                 SET ativa = false, atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = $1 AND escola_id = $2`,
                [id, escolaId]
            );
            await client.query('COMMIT');
            return res.json({
                success: true,
                message: 'Item anulado. O histórico de pagamentos foi preservado.',
                data: { id, acao: 'anulado' }
            });
        }

        await client.query(
            `DELETE FROM propinas_taxas WHERE id = $1 AND escola_id = $2`,
            [id, escolaId]
        );
        await client.query('COMMIT');
        return res.json({
            success: true,
            message: 'Item apagado porque ainda não tinha pagamentos associados.',
            data: { id, acao: 'apagado' }
        });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Erro ao apagar ou anular item de pagamento:', error);
        if (error.code === '23503') {
            return res.status(409).json({
                success: false,
                message: 'O item recebeu um pagamento durante a operação. Tente novamente para o anular e preservar o histórico.'
            });
        }
        return res.status(500).json({ success: false, message: 'Não foi possível apagar ou anular o item de pagamento.' });
    } finally {
        client?.release();
    }
});

router.get('/configuracoes', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Acesso às configurações de tesouraria não autorizado.' });
        }

        const [niveis, itens, classes, polos] = await Promise.all([
            db.query(
                `SELECT ne.id, ne.nome
                 FROM escolas_niveis en
                 JOIN niveis_ensino ne ON ne.id = en.nivel_id
                 WHERE en.escola_id = $1
                 ORDER BY ne.nome`,
                [escolaId]
            ),
            db.query(
                `SELECT pt.id, pt.nome, pt.valor, pt.tipo, pt.periodicidade,
                        pt.obrigatoria AS obrigatorio, pt.ativa,
                           COALESCE(ARRAY_AGG(ptn.nivel_id) FILTER (WHERE ptn.nivel_id IS NOT NULL), ARRAY[]::uuid[]) AS nivel_ids,
                           COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                   'classe', ptc.classe,
                                   'ano_letivo_id', ptc.ano_letivo_id,
                                   'ano_nome', al.ano_nome,
                                   'valor', ptc.valor,
                                   'data_vencimento', ptc.data_vencimento
                               ) ORDER BY al.ano_nome DESC NULLS LAST, ptc.classe)
                               FROM propinas_taxas_classes ptc
                               LEFT JOIN anos_letivos al ON al.id = ptc.ano_letivo_id
                               WHERE ptc.propina_taxa_id = pt.id AND ptc.escola_id = pt.escola_id
                           ), '[]'::jsonb) AS classe_precos,
                           COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                   'polo_id', ptp.polo_id,
                                   'polo_nome', p.nome,
                                   'ano_letivo_id', ptp.ano_letivo_id,
                                   'ano_nome', al.ano_nome,
                                   'valor', ptp.valor,
                                   'data_vencimento', ptp.data_vencimento
                               ) ORDER BY al.ano_nome DESC NULLS LAST, p.nome)
                               FROM propinas_taxas_polos ptp
                               JOIN polos_escola p ON p.id = ptp.polo_id
                               LEFT JOIN anos_letivos al ON al.id = ptp.ano_letivo_id
                               WHERE ptp.propina_taxa_id = pt.id AND p.escola_id = pt.escola_id
                           ), '[]'::jsonb) AS polo_precos
                    FROM propinas_taxas pt
                 LEFT JOIN propinas_taxas_niveis ptn ON ptn.propina_taxa_id = pt.id
                 WHERE pt.escola_id = $1
                 GROUP BY pt.id
                 ORDER BY pt.tipo, pt.nome`,
                [escolaId]
            ),
            db.query(
                `SELECT t.classe, cn.nivel_id, ne.nome AS nivel_nome
                 FROM (SELECT DISTINCT classe FROM turmas WHERE escola_id = $1 AND classe IS NOT NULL AND BTRIM(classe) <> '') t
                 LEFT JOIN tesouraria_classes_niveis cn
                   ON cn.escola_id = $1 AND LOWER(BTRIM(cn.classe)) = LOWER(BTRIM(t.classe))
                 LEFT JOIN niveis_ensino ne ON ne.id = cn.nivel_id
                 ORDER BY t.classe`,
                [escolaId]
            ),
            db.query(
                `SELECT id, nome FROM polos_escola
                 WHERE escola_id = $1 AND ativo = true
                 ORDER BY nome`,
                [escolaId]
            )
        ]);

        return res.json({
            success: true,
            dados: { niveis: niveis.rows, itens: itens.rows, classes: classes.rows, polos: polos.rows }
        });
    } catch (error) {
        console.error('Erro ao carregar configurações de tesouraria:', error);
        return res.status(500).json({ success: false, message: 'Erro ao carregar configurações de tesouraria.' });
    }
});

router.put('/configuracoes/classes', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { classe, nivel_id } = req.body || {};
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Sem permissão para alterar associações de turmas e níveis.' });
        }
        if (typeof classe !== 'string' || !classe.trim() || classe.trim().length > 100 ||
            nivel_id !== null && !UUID_PATTERN.test(nivel_id || '')) {
            return res.status(400).json({ success: false, message: 'Indique uma classe e um nível válidos.' });
        }

        if (nivel_id === null) {
            await db.query(
                `DELETE FROM tesouraria_classes_niveis WHERE escola_id = $1 AND LOWER(BTRIM(classe)) = LOWER(BTRIM($2))`,
                [escolaId, classe.trim()]
            );
            return res.json({ success: true, message: 'Associação da classe removida.' });
        }

        const nivel = await db.query(
            `SELECT 1 FROM escolas_niveis WHERE escola_id = $1 AND nivel_id = $2`,
            [escolaId, nivel_id]
        );
        if (!nivel.rowCount) {
            return res.status(400).json({ success: false, message: 'O nível selecionado não pertence a esta escola.' });
        }

        const classeExiste = await db.query(
            `SELECT classe FROM turmas WHERE escola_id = $1 AND LOWER(BTRIM(classe)) = LOWER(BTRIM($2)) LIMIT 1`,
            [escolaId, classe.trim()]
        );
        if (!classeExiste.rowCount) {
            return res.status(404).json({ success: false, message: 'A classe não está associada a nenhuma turma desta escola.' });
        }

        await db.query(
            `INSERT INTO tesouraria_classes_niveis (escola_id, classe, nivel_id, atualizado_em)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (escola_id, classe) DO UPDATE
             SET nivel_id = EXCLUDED.nivel_id, atualizado_em = CURRENT_TIMESTAMP`,
            [escolaId, classeExiste.rows[0].classe.trim(), nivel_id]
        );
        return res.json({ success: true, message: 'Nível associado à classe com sucesso.' });
    } catch (error) {
        console.error('Erro ao associar classe a nível:', error);
        return res.status(500).json({ success: false, message: 'Erro ao guardar associação da classe.' });
    }
});

router.get('/rastreio-alunos', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const {
            ano_letivo_id: anoLetivoId,
            polo_id: poloId,
            turma_id: turmaId,
            busca
        } = req.query;
        const pagina = Number.parseInt(req.query.pagina || '1', 10);
        const porPagina = Number.parseInt(req.query.por_pagina || '25', 10);
        const termo = typeof busca === 'string' ? busca.trim() : '';
        const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
            .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const eAluno = ['aluno', 'estudante'].includes(papel);

        if (!escolaId || (!eAluno && !podeVincularTalaoSecretaria(req))) {
            return res.status(403).json({ success: false, message: 'Sem autorização para consultar esta conta financeira.' });
        }
        if (!UUID_PATTERN.test(anoLetivoId || '') || !UUID_PATTERN.test(poloId || '') ||
            (turmaId && !UUID_PATTERN.test(turmaId)) ||
            !Number.isInteger(pagina) || pagina < 1 ||
            !Number.isInteger(porPagina) || porPagina < 1 || porPagina > 25 ||
            termo.length > 100) {
            return res.status(400).json({ success: false, message: 'Ano letivo, ramo, filtros ou paginação inválidos.' });
        }

        const anoResult = await db.query(
            `SELECT eal.ano_letivo_id, al.ano_nome,
                    eal.data_inicio::text AS data_inicio,
                    eal.data_fim::text AS data_fim,
                    CURRENT_DATE::text AS hoje
             FROM escola_anos_letivos eal
             JOIN anos_letivos al ON al.id = eal.ano_letivo_id
             WHERE eal.escola_id = $1 AND eal.ano_letivo_id = $2
               AND eal.data_inicio IS NOT NULL AND eal.data_fim IS NOT NULL
               AND eal.data_inicio <= eal.data_fim`,
            [escolaId, anoLetivoId]
        );
        if (!anoResult.rowCount) {
            return res.status(404).json({ success: false, message: 'O ano letivo não pertence à escola ou não tem datas válidas.' });
        }
        const poloResult = await db.query(
            `SELECT nome FROM polos_escola WHERE id = $1 AND escola_id = $2 AND ativo = true`,
            [poloId, escolaId]
        );
        if (!poloResult.rowCount) {
            return res.status(404).json({ success: false, message: 'O ramo não pertence à escola ou está inativo.' });
        }

        const ano = anoResult.rows[0];
        const inicioAno = String(ano.data_inicio).slice(0, 10);
        const fimAno = String(ano.data_fim).slice(0, 10);
        const dataCalculo = String(ano.hoje).slice(0, 10);
        const filtroBusca = termo ? `%${termo}%` : null;
        const offset = (pagina - 1) * porPagina;
        const filtroTurma = turmaId || null;
        let alunoIdFiltro = null;
        if (eAluno) {
            const alunoResult = await db.query(
                `SELECT a.id
                 FROM alunos a
                 JOIN associacoes_escola ae
                   ON ae.utilizador_id = a.utilizador_id
                  AND ae.escola_id = $2 AND ae.status = 'ativo'
                 JOIN papeis_utilizador pu
                   ON pu.associacao_id = ae.id
                  AND LOWER(TRIM(pu.papel)) IN ('aluno', 'estudante')
                 WHERE a.utilizador_id = $1
                 LIMIT 1`,
                [req.user?.id, escolaId]
            );
            if (!alunoResult.rowCount) {
                return res.status(404).json({ success: false, message: 'Não foi encontrada uma conta de aluno associada a esta escola.' });
            }
            alunoIdFiltro = alunoResult.rows[0].id;
        }
        const [totalResult, alunosResult, itensResult] = await Promise.all([
            db.query(
                `SELECT COUNT(*)::int AS total
                 FROM matriculas m
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 JOIN alunos a ON a.id = m.aluno_id
                 JOIN utilizadores u ON u.id = a.utilizador_id
                 WHERE m.escola_id = $1 AND m.estado = 'ativa'
                   AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2
                   AND m.polo_id = $3
                   AND ($4::uuid IS NULL OR m.turma_id = $4)
                   AND ($5::text IS NULL OR u.nome ILIKE $5 OR a.apelido ILIKE $5
                     OR m.numero_matricula ILIKE $5 OR m.id::text ILIKE $5
                     OR a.id::text ILIKE $5 OR u.login_id ILIKE $5
                     OR u.telefone ILIKE $5 OR u.email ILIKE $5)
                   AND ($6::uuid IS NULL OR m.aluno_id = $6)`,
                [escolaId, anoLetivoId, poloId, filtroTurma, filtroBusca, alunoIdFiltro]
            ),
            db.query(
                `SELECT m.id AS matricula_id, m.aluno_id, m.numero_matricula,
                        m.data_matricula::text AS data_matricula,
                        COALESCE(m.ano_letivo_id, t.ano_letivo_id) AS ano_letivo_id,
                        m.polo_id, t.id AS turma_id,
                        t.classe,
                        COALESCE(t.nome, t.classe, 'Turma não atribuída') AS turma,
                        cn.nivel_id, TRIM(CONCAT_WS(' ', u.nome, a.apelido)) AS nome,
                        a.id::text AS identificador_aluno
                 FROM matriculas m
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 JOIN alunos a ON a.id = m.aluno_id
                 JOIN utilizadores u ON u.id = a.utilizador_id
                 LEFT JOIN tesouraria_classes_niveis cn
                   ON cn.escola_id = m.escola_id
                  AND LOWER(BTRIM(cn.classe)) = LOWER(BTRIM(t.classe))
                 WHERE m.escola_id = $1 AND m.estado = 'ativa'
                   AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2
                   AND m.polo_id = $3
                   AND ($4::uuid IS NULL OR m.turma_id = $4)
                   AND ($5::text IS NULL OR u.nome ILIKE $5 OR a.apelido ILIKE $5
                     OR m.numero_matricula ILIKE $5 OR m.id::text ILIKE $5
                     OR a.id::text ILIKE $5 OR u.login_id ILIKE $5
                     OR u.telefone ILIKE $5 OR u.email ILIKE $5)
                   AND ($6::uuid IS NULL OR m.aluno_id = $6)
                 ORDER BY u.nome, a.apelido, m.numero_matricula
                 LIMIT $7 OFFSET $8`,
                [escolaId, anoLetivoId, poloId, filtroTurma, filtroBusca, alunoIdFiltro, porPagina, offset]
            ),
            db.query(
                `SELECT pt.id, pt.nome, pt.periodicidade, pt.obrigatoria,
                        ptc.classe, ptc.valor::numeric AS valor, ptc.data_vencimento::text AS data_vencimento,
                        COALESCE(ARRAY_AGG(ptn.nivel_id) FILTER (WHERE ptn.nivel_id IS NOT NULL), ARRAY[]::uuid[]) AS nivel_ids
                 FROM propinas_taxas pt
                 JOIN propinas_taxas_classes ptc
                   ON ptc.propina_taxa_id = pt.id
                  AND ptc.escola_id = pt.escola_id
                  AND ptc.ano_letivo_id = $3
                  AND EXISTS (
                    SELECT 1 FROM turmas classe_turma
                    WHERE classe_turma.escola_id = pt.escola_id
                      AND classe_turma.ano_letivo_id = ptc.ano_letivo_id
                      AND classe_turma.polo_id = $2
                      AND LOWER(BTRIM(classe_turma.classe)) = LOWER(BTRIM(ptc.classe))
                  )
                 LEFT JOIN propinas_taxas_niveis ptn ON ptn.propina_taxa_id = pt.id
                 WHERE pt.escola_id = $1 AND pt.ativa = true
                 GROUP BY pt.id, ptc.classe, ptc.valor, ptc.data_vencimento
                 ORDER BY pt.nome`,
                [escolaId, poloId, anoLetivoId]
            )
        ]);
        if (filtroTurma) {
            const turma = await db.query(
                `SELECT 1 FROM turmas WHERE id = $1 AND escola_id = $2 AND polo_id = $3 AND ano_letivo_id = $4`,
                [filtroTurma, escolaId, poloId, anoLetivoId]
            );
            if (!turma.rowCount) {
                return res.status(400).json({ success: false, message: 'A turma não pertence ao ano letivo e ramo selecionados.' });
            }
        }

        const alunos = alunosResult.rows;
        const itens = itensResult.rows;
        const matriculaIds = alunos.map((aluno) => aluno.matricula_id);
        const itemIds = itens.map((item) => item.id);
        let pagamentos = [];
        if (matriculaIds.length && itemIds.length) {
            const pagamentosResult = await db.query(
                `SELECT pagamento.id::text AS id, pagamento.matricula_id,
                        pagamento.propina_taxa_id, COALESCE(pagamento.classe, turma.classe) AS classe,
                        pagamento.valor,
                        pagamento.data_pagamento::text AS data,
                        pagamento.codigo_talao, pagamento.referencia_banco AS referencia,
                        pagamento.banco_origem AS metodo, pagamento.estado,
                        COALESCE(item.nome, 'Pagamento escolar') AS item
                 FROM tesouraria_pagamentos pagamento
                 LEFT JOIN propinas_taxas item ON item.id = pagamento.propina_taxa_id
                 LEFT JOIN matriculas matricula ON matricula.id = pagamento.matricula_id AND matricula.escola_id = pagamento.escola_id
                 LEFT JOIN turmas turma ON turma.id = matricula.turma_id AND turma.escola_id = matricula.escola_id
                 WHERE pagamento.escola_id = $1
                   AND pagamento.matricula_id = ANY($2::uuid[])
                   AND pagamento.propina_taxa_id = ANY($3::uuid[])
                   AND pagamento.estado = 'aprovado'
                   AND (
                     pagamento.ano_letivo_id = $4
                     OR (pagamento.ano_letivo_id IS NULL
                       AND pagamento.data_pagamento BETWEEN $5::date AND $6::date)
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                     WHERE alocacao.pagamento_id = pagamento.id
                   )

                 UNION ALL

                 SELECT pagamento.id::text AS id, alocacao.matricula_id,
                        alocacao.propina_taxa_id, alocacao.classe, alocacao.valor,
                        pagamento.data_pagamento::text AS data,
                        pagamento.codigo_talao, pagamento.referencia_banco AS referencia,
                        pagamento.banco_origem AS metodo, pagamento.estado,
                        item.nome
                 FROM tesouraria_pagamentos_alocacoes alocacao
                 JOIN tesouraria_pagamentos pagamento
                   ON pagamento.id = alocacao.pagamento_id
                  AND pagamento.escola_id = alocacao.escola_id
                 JOIN propinas_taxas item ON item.id = alocacao.propina_taxa_id
                 WHERE alocacao.escola_id = $1
                   AND alocacao.matricula_id = ANY($2::uuid[])
                   AND alocacao.propina_taxa_id = ANY($3::uuid[])
                   AND pagamento.estado = 'aprovado'
                   AND alocacao.ano_letivo_id = $4

                 UNION ALL

                 SELECT movimento.id::text AS id, alocacao.matricula_id,
                        alocacao.propina_taxa_id, alocacao.classe, alocacao.valor,
                        movimento.data_movimento::text AS data,
                        movimento.referencia AS codigo_talao,
                        movimento.referencia, movimento.metodo,
                        'aprovado'::text AS estado, item.nome
                 FROM tesouraria_pagamentos_alocacoes alocacao
                 JOIN tesouraria_movimentos movimento
                   ON movimento.id = alocacao.movimento_id
                  AND movimento.escola_id = alocacao.escola_id
                 JOIN propinas_taxas item ON item.id = alocacao.propina_taxa_id
                 WHERE alocacao.escola_id = $1
                   AND alocacao.matricula_id = ANY($2::uuid[])
                   AND alocacao.propina_taxa_id = ANY($3::uuid[])
                   AND movimento.tipo = 'entrada'
                   AND alocacao.ano_letivo_id = $4
                 ORDER BY data DESC, id`,
                [escolaId, matriculaIds, itemIds, anoLetivoId, inicioAno, fimAno]
            );
            pagamentos = pagamentosResult.rows;
        }

        const pagamentosPorMatriculaItem = new Map();
        const pagamentosPorMatricula = new Map();
        for (const pagamento of pagamentos) {
            const valorCentimos = Math.round(Number(pagamento.valor || 0) * 100);
            const classePagamento = String(pagamento.classe || '').trim().toLowerCase();
            const chave = `${pagamento.matricula_id}:${pagamento.propina_taxa_id}:${classePagamento}`;
            pagamentosPorMatriculaItem.set(chave, (pagamentosPorMatriculaItem.get(chave) || 0) + valorCentimos);
            const historico = pagamentosPorMatricula.get(pagamento.matricula_id) || [];
            historico.push({
                id: `${pagamento.id}:${pagamento.propina_taxa_id}`,
                data: String(pagamento.data).slice(0, 10),
                item: pagamento.item,
                valor: valorCentimos / 100,
                referencia: pagamento.codigo_talao || pagamento.referencia || '',
                metodo: pagamento.metodo || '',
                estado: pagamento.estado
            });
            pagamentosPorMatricula.set(pagamento.matricula_id, historico);
        }

        const dados = alunos.map((aluno) => {
            const inicioMatricula = String(aluno.data_matricula).slice(0, 10);
            const inicioObrigacao = inicioMatricula > inicioAno ? inicioMatricula : inicioAno;
            const contaItens = [];
            let totalEscolaCentimos = 0;
            let totalPagoCentimos = 0;
            const classeAluno = String(aluno.classe || '').trim().toLowerCase();

            for (const item of itens) {
                const classeItem = String(item.classe || '').trim().toLowerCase();
                if (classeItem !== classeAluno) continue;
                if (item.nivel_ids.length &&
                    (!aluno.nivel_id || !item.nivel_ids.includes(aluno.nivel_id))) continue;
                const periodos = item.obrigatoria
                    ? periodosVencidos(item, inicioObrigacao, fimAno, fimAno)
                    : [];
                const valorItemCentimos = Math.round(Number(item.valor || 0) * 100);
                const totalItemCentimos = valorItemCentimos * periodos.length;
                const pagoCentimos = pagamentosPorMatriculaItem.get(
                    `${aluno.matricula_id}:${item.id}:${classeAluno}`
                ) || 0;
                totalEscolaCentimos += totalItemCentimos;
                totalPagoCentimos += pagoCentimos;
                if (totalItemCentimos || pagoCentimos) {
                    contaItens.push({
                        id: item.id,
                        nome: item.nome,
                        obrigatorio: item.obrigatoria,
                        periodicidade: item.periodicidade,
                        parcelas_previstas: periodos.length,
                        valor_parcela: valorItemCentimos / 100,
                        total_previsto: totalItemCentimos / 100,
                        total_pago: pagoCentimos / 100,
                        saldo: Math.max(totalItemCentimos - pagoCentimos, 0) / 100
                    });
                }
            }
            const historico = pagamentosPorMatricula.get(aluno.matricula_id) || [];
            historico.sort((a, b) => b.data.localeCompare(a.data));
            const totalEmFaltaCentimos = Math.max(totalEscolaCentimos - totalPagoCentimos, 0);
            return {
                id: aluno.matricula_id,
                aluno_id: aluno.aluno_id,
                matricula_id: aluno.matricula_id,
                nome: aluno.nome,
                matricula: aluno.numero_matricula || aluno.identificador_aluno,
                turma: aluno.turma,
                totalEscola: totalEscolaCentimos / 100,
                jaPagou: totalPagoCentimos / 100,
                sobra: totalEmFaltaCentimos / 100,
                credito: Math.max(totalPagoCentimos - totalEscolaCentimos, 0) / 100,
                conta_itens: contaItens,
                historico
            };
        });
        const total = Number(totalResult.rows[0]?.total || 0);
        return res.json({
            success: true,
            dados,
            resumo: {
                total_alunos: total,
                total_previsto: dados.reduce((soma, aluno) => soma + aluno.totalEscola, 0),
                total_pago: dados.reduce((soma, aluno) => soma + aluno.jaPagou, 0),
                saldo_em_falta: dados.reduce((soma, aluno) => soma + aluno.sobra, 0)
            },
            paginacao: {
                pagina,
                por_pagina: porPagina,
                total_registos: total,
                total_paginas: Math.ceil(total / porPagina)
            },
            ano_letivo: { id: ano.ano_letivo_id, nome: ano.ano_nome },
            polo: { id: poloId, nome: poloResult.rows[0].nome },
            calculado_ate: dataCalculo
        });
    } catch (error) {
        console.error('Erro ao calcular contas financeiras dos alunos:', error);
        return res.status(500).json({
            success: false,
            message: error.code === '42P01'
                ? 'A estrutura de contas financeiras ainda não foi instalada. Aplique 20261107_tesouraria_z_contas_financeiras_alunos.sql e 20261109_precos_pagamento_por_classe.sql.'
                : 'Não foi possível calcular as contas financeiras dos alunos.'
        });
    }
});

router.get('/devedores/opcoes', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const anoResult = await db.query(
            `SELECT el.ano_letivo_id, al.ano_nome,
                    el.data_inicio::text AS data_inicio, el.data_fim::text AS data_fim
             FROM escola_anos_letivos el
             JOIN anos_letivos al ON al.id = el.ano_letivo_id
             WHERE el.escola_id = $1 AND el.ativo = true
               AND el.data_inicio IS NOT NULL AND el.data_fim IS NOT NULL
               AND el.data_inicio <= el.data_fim
             ORDER BY CASE WHEN CURRENT_DATE BETWEEN el.data_inicio AND el.data_fim THEN 0 ELSE 1 END,
                      el.data_inicio DESC
             LIMIT 1`,
            [escolaId]
        );
        if (!anoResult.rowCount) {
            return res.status(409).json({
                success: false,
                message: 'Não há ano letivo ativo com datas válidas. Corrija o período na configuração da escola antes de calcular atrasos.'
            });
        }

        const ano = anoResult.rows[0];
        const [niveisResult, polosResult, turmasResult] = await Promise.all([
            db.query(
                `SELECT ne.id, ne.nome
                 FROM escolas_niveis en
                 JOIN niveis_ensino ne ON ne.id = en.nivel_id
                 WHERE en.escola_id = $1
                 ORDER BY ne.nome`,
                [escolaId]
            ),
            db.query(
                `SELECT id, nome
                 FROM polos_escola
                 WHERE escola_id = $1 AND ativo = true
                 ORDER BY nome`,
                [escolaId]
            ),
            db.query(
                `SELECT id, nome, classe, polo_id
                 FROM turmas
                 WHERE escola_id = $1 AND ano_letivo_id = $2 AND ativo = true
                 ORDER BY classe, nome`,
                [escolaId, ano.ano_letivo_id]
            )
        ]);

        return res.json({
            success: true,
            dados: {
                ano_letivo_id: ano.ano_letivo_id,
                ano_letivo: ano.ano_nome,
                niveis: niveisResult.rows,
                polos: polosResult.rows,
                turmas: turmasResult.rows
            }
        });
    } catch (error) {
        console.error('Erro ao carregar opções de pagamentos em atraso:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível carregar as opções de pagamentos em atraso.' });
    }
});

router.get('/devedores', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const dataLimite = req.query.ate || new Date().toISOString().slice(0, 10);
        const nivelFiltro = req.query.nivel_id || '';
        const poloFiltro = req.query.polo_id || '';
        const turmaFiltro = req.query.turma_id || '';
        const anoLetivoFiltro = req.query.ano_letivo_id || '';
        const apenasResumo = req.query.resumo === 'true';
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!dataIsoValida(dataLimite) ||
            (nivelFiltro && !UUID_PATTERN.test(nivelFiltro)) ||
            (poloFiltro && !UUID_PATTERN.test(poloFiltro)) ||
            (turmaFiltro && !UUID_PATTERN.test(turmaFiltro)) ||
            (anoLetivoFiltro && !UUID_PATTERN.test(anoLetivoFiltro))) {
            return res.status(400).json({ success: false, message: 'Indique uma data, ramo, turma e nível válidos.' });
        }
        if (!apenasResumo && !turmaFiltro) {
            return res.status(400).json({ success: false, message: 'Selecione uma turma para consultar os pagamentos em atraso.' });
        }
        if (!apenasResumo && dataLimite > new Date().toISOString().slice(0, 10)) {
            return res.status(400).json({ success: false, message: 'A data limite não pode ser futura.' });
        }

        const anoResult = await db.query(
            `            SELECT el.ano_letivo_id, al.ano_nome,
                   el.data_inicio::text AS data_inicio, el.data_fim::text AS data_fim
             FROM escola_anos_letivos el
             JOIN anos_letivos al ON al.id = el.ano_letivo_id
             WHERE el.escola_id = $1
               AND (($3::uuid IS NOT NULL AND el.ano_letivo_id = $3)
                 OR ($3::uuid IS NULL AND el.ativo = true))
               AND el.data_inicio IS NOT NULL AND el.data_fim IS NOT NULL
               AND el.data_inicio <= el.data_fim
             ORDER BY CASE WHEN $3::uuid IS NOT NULL THEN 0
                           WHEN $2::date BETWEEN el.data_inicio AND el.data_fim THEN 0 ELSE 1 END,
                      el.data_inicio DESC
             LIMIT 1`,
            [escolaId, dataLimite, anoLetivoFiltro || null]
        );
        if (!anoResult.rowCount) {
            return res.status(409).json({
                success: false,
                message: 'Não há ano letivo ativo com datas válidas. Corrija o período na configuração da escola antes de calcular atrasos.'
            });
        }

        const ano = anoResult.rows[0];
        const inicioAno = String(ano.data_inicio).slice(0, 10);
        const fimAno = String(ano.data_fim).slice(0, 10);
        const limite = dataLimite < fimAno ? dataLimite : fimAno;
        const [itensResult, alunosResult, niveisResult, polosResult, turmasResult] = await Promise.all([
            db.query(
                `SELECT pt.id, pt.nome, pt.periodicidade, pt.obrigatoria,
                        ptc.valor::numeric AS valor, ptc.data_vencimento::text AS data_vencimento,
                        ptc.classe,
                        COALESCE(ARRAY_AGG(DISTINCT ptn.nivel_id)
                            FILTER (WHERE ptn.nivel_id IS NOT NULL), ARRAY[]::uuid[]) AS nivel_ids
                 FROM propinas_taxas pt
                 JOIN propinas_taxas_classes ptc
                   ON ptc.propina_taxa_id = pt.id
                  AND ptc.escola_id = pt.escola_id
                  AND ptc.ano_letivo_id = $2
                  AND ($3::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM turmas ramo_turma
                    WHERE ramo_turma.escola_id = pt.escola_id
                      AND ramo_turma.ano_letivo_id = ptc.ano_letivo_id
                      AND ramo_turma.polo_id = $3
                      AND LOWER(BTRIM(ramo_turma.classe)) = LOWER(BTRIM(ptc.classe))
                  ))
                 LEFT JOIN propinas_taxas_niveis ptn ON ptn.propina_taxa_id = pt.id
                 WHERE pt.escola_id = $1 AND pt.ativa = true AND pt.obrigatoria = true
                 GROUP BY pt.id, ptc.classe, ptc.valor, ptc.data_vencimento
                 ORDER BY ptc.classe, pt.nome`,
                [escolaId, ano.ano_letivo_id, poloFiltro || null]
            ),
            db.query(
                `SELECT m.id AS matricula_id, m.data_matricula::text AS data_matricula,
                        m.numero_matricula, COALESCE(m.polo_id, t.polo_id) AS polo_id,
                        t.id AS turma_id, t.nome AS turma_nome, t.classe,
                        cn.nivel_id, u.nome AS aluno_nome, a.apelido AS aluno_apelido
                 FROM matriculas m
                 JOIN alunos a ON a.id = m.aluno_id
                 JOIN utilizadores u ON u.id = a.utilizador_id
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 LEFT JOIN tesouraria_classes_niveis cn
                   ON cn.escola_id = m.escola_id AND LOWER(BTRIM(cn.classe)) = LOWER(BTRIM(t.classe))
                 WHERE m.escola_id = $1
                   AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2
                   AND m.estado = 'ativa'
                   AND ($3::uuid IS NULL OR COALESCE(m.polo_id, t.polo_id) = $3)
                   AND ($4::uuid IS NULL OR t.id = $4)
                 ORDER BY u.nome, a.apelido`,
                [escolaId, ano.ano_letivo_id, poloFiltro || null, turmaFiltro || null]
            ),
            db.query(
                `SELECT ne.id, ne.nome
                 FROM escolas_niveis en JOIN niveis_ensino ne ON ne.id = en.nivel_id
                 WHERE en.escola_id = $1 ORDER BY ne.nome`,
                [escolaId]
            ),
            db.query(
                `SELECT id, nome FROM polos_escola
                 WHERE escola_id = $1 AND ativo = true ORDER BY nome`,
                [escolaId]
            ),
            db.query(
                `SELECT id, nome, classe, polo_id FROM turmas
                 WHERE escola_id = $1 AND ano_letivo_id = $2 AND ativo = true
                   AND ($3::uuid IS NULL OR polo_id = $3)
                 ORDER BY classe, nome`,
                [escolaId, ano.ano_letivo_id, poloFiltro || null]
            )
        ]);

        const items = itensResult.rows;
        const alunos = alunosResult.rows;
        const matriculaIds = alunos.map((aluno) => aluno.matricula_id);
        const itemIds = [...new Set(items.map((item) => item.id))];
        let pagamentos = [];
        if (matriculaIds.length && itemIds.length) {
            const result = await db.query(
                `SELECT pagamentos.matricula_id, pagamentos.propina_taxa_id,
                        COALESCE(pagamentos.classe, turma.classe) AS classe,
                        pagamentos.data_pagamento::text AS data_pagamento,
                        pagamentos.valor, pagamentos.estado
                 FROM tesouraria_pagamentos pagamentos
                 LEFT JOIN matriculas matricula ON matricula.id = pagamentos.matricula_id AND matricula.escola_id = pagamentos.escola_id
                 LEFT JOIN turmas turma ON turma.id = matricula.turma_id AND turma.escola_id = matricula.escola_id
                 WHERE pagamentos.escola_id = $1
                   AND pagamentos.matricula_id = ANY($2::uuid[])
                   AND pagamentos.propina_taxa_id = ANY($3::uuid[])
                   AND pagamentos.data_pagamento >= $4::date
                   AND pagamentos.data_pagamento <= $5::date
                   AND pagamentos.estado = 'aprovado'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM tesouraria_pagamentos_alocacoes alocacao
                     WHERE alocacao.pagamento_id = pagamentos.id
                   )

                 UNION ALL

                 SELECT alocacao.matricula_id, alocacao.propina_taxa_id, alocacao.classe,
                        pagamentos.data_pagamento::text AS data_pagamento,
                        alocacao.valor, pagamentos.estado
                 FROM tesouraria_pagamentos_alocacoes alocacao
                 JOIN tesouraria_pagamentos pagamentos
                   ON pagamentos.id = alocacao.pagamento_id
                  AND pagamentos.escola_id = alocacao.escola_id
                 WHERE alocacao.escola_id = $1
                   AND alocacao.matricula_id = ANY($2::uuid[])
                   AND alocacao.propina_taxa_id = ANY($3::uuid[])
                   AND pagamentos.data_pagamento >= $4::date
                   AND pagamentos.data_pagamento <= $5::date
                   AND pagamentos.estado = 'aprovado'

                 UNION ALL

                 SELECT alocacao.matricula_id, alocacao.propina_taxa_id, alocacao.classe,
                        movimentos.data_movimento::text AS data_pagamento,
                        alocacao.valor, 'aprovado'::text AS estado
                 FROM tesouraria_pagamentos_alocacoes alocacao
                 JOIN tesouraria_movimentos movimentos
                   ON movimentos.id = alocacao.movimento_id
                  AND movimentos.escola_id = alocacao.escola_id
                 WHERE alocacao.escola_id = $1
                   AND alocacao.matricula_id = ANY($2::uuid[])
                   AND alocacao.propina_taxa_id = ANY($3::uuid[])
                   AND movimentos.data_movimento >= $4::date
                   AND movimentos.data_movimento <= $5::date
                   AND movimentos.tipo = 'entrada'
                 ORDER BY data_pagamento`,
                [escolaId, matriculaIds, itemIds, inicioAno, limite]
            );
            pagamentos = result.rows;
        }

        const pagamentoPorPar = new Map();
        for (const pagamento of pagamentos) {
            const classePagamento = String(pagamento.classe || '').trim().toLowerCase();
            const key = `${pagamento.matricula_id}:${pagamento.propina_taxa_id}:${classePagamento}`;
            const current = pagamentoPorPar.get(key) || 0;
            const valorCentimos = Math.round((Number(pagamento.valor) || 0) * 100);
            pagamentoPorPar.set(key, current + valorCentimos);
        }

        const alunosCalculados = [];
        for (const aluno of alunos) {
            const dividas = [];
            const cobrancas = [];
            let totalPrevistoCentimos = 0;
            const classeAluno = String(aluno.classe || '').trim().toLowerCase();
            for (const item of items) {
                const classeItem = String(item.classe || '').trim().toLowerCase();
                if (classeItem !== classeAluno ||
                    item.nivel_ids.length && !aluno.nivel_id) {
                    cobrancas.push({
                        item_id: item.id,
                        classe: item.classe,
                        situacao: classeItem === classeAluno && item.nivel_ids.length && !aluno.nivel_id
                            ? 'nivel_nao_configurado'
                            : 'nao_aplicavel',
                        parcelas: [],
                        em_falta: 0
                    });
                    continue;
                }
                if (item.nivel_ids.length && !item.nivel_ids.includes(aluno.nivel_id)) {
                    cobrancas.push({
                        item_id: item.id,
                        classe: item.classe,
                        situacao: 'nao_aplicavel',
                        parcelas: [],
                        em_falta: 0
                    });
                    continue;
                }
                const inicioMatricula = String(aluno.data_matricula).slice(0, 10);
                const inicioObrigacao = inicioMatricula > inicioAno ? inicioMatricula : inicioAno;
                const limiteCalculo = apenasResumo ? fimAno : limite;
                const periodos = periodosVencidos(item, inicioObrigacao, fimAno, limiteCalculo);
                totalPrevistoCentimos += periodos.length * Math.round((Number(item.valor) || 0) * 100);
                let saldoPagoCentimos = pagamentoPorPar.get(
                    `${aluno.matricula_id}:${item.id}:${String(item.classe).trim().toLowerCase()}`
                ) || 0;
                const parcelas = [];
                for (const vencimento of periodos) {
                    const esperadoCentimos = Math.round((Number(item.valor) || 0) * 100);
                    const aplicadoCentimos = Math.min(esperadoCentimos, saldoPagoCentimos);
                    saldoPagoCentimos -= aplicadoCentimos;
                    const emFaltaCentimos = Math.max(0, esperadoCentimos - aplicadoCentimos);
                    if (emFaltaCentimos > 0) {
                        const parcela = {
                            item_id: item.id,
                            item_nome: item.nome,
                            vencimento,
                            esperado: esperadoCentimos / 100,
                            pago: aplicadoCentimos / 100,
                            em_falta: emFaltaCentimos / 100
                        };
                        parcelas.push(parcela);
                        dividas.push(parcela);
                    }
                }
                cobrancas.push({
                    item_id: item.id,
                    classe: item.classe,
                    item_nome: item.nome,
                    valor_parcela: Number(item.valor),
                    periodicidade: item.periodicidade,
                    data_vencimento: item.data_vencimento,
                    situacao: parcelas.length ? 'em_atraso' : periodos.length ? 'pago' : 'a_vencer',
                    parcelas,
                    em_falta: parcelas.reduce((total, parcela) => total + parcela.em_falta, 0)
                });
            }

            dividas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
            alunosCalculados.push({
                matricula_id: aluno.matricula_id,
                numero_matricula: aluno.numero_matricula,
                aluno_nome: aluno.aluno_nome,
                aluno_apelido: aluno.aluno_apelido,
                polo_id: aluno.polo_id,
                turma_id: aluno.turma_id,
                turma_nome: aluno.turma_nome,
                classe: aluno.classe,
                nivel_id: aluno.nivel_id,
                divida_total: dividas.reduce((total, divida) => total + divida.em_falta, 0),
                primeiro_vencimento: dividas[0]?.vencimento || null,
                total_previsto: totalPrevistoCentimos / 100,
                dividas,
                cobrancas
            });
        }

        const selecionados = (nivelFiltro
            ? alunosCalculados.filter((aluno) => aluno.nivel_id === nivelFiltro)
            : alunosCalculados).sort((a, b) =>
            a.aluno_nome.localeCompare(b.aluno_nome) || String(a.aluno_apelido || '').localeCompare(String(b.aluno_apelido || ''))
        );
        const alunosEmAtraso = selecionados.filter((aluno) => aluno.divida_total > 0);
        const totalEmDivida = alunosEmAtraso.reduce((total, aluno) => total + aluno.divida_total, 0);
        if (apenasResumo) {
            return res.json({
                success: true,
                dados: {
                    ano_letivo: ano.ano_nome,
                    data_limite: dataLimite,
                    total_alunos: selecionados.length,
                    alunos_com_divida: alunosEmAtraso.length,
                    total_previsto: selecionados.reduce((total, aluno) => total + aluno.total_previsto, 0)
                }
            });
        }
        const classesSemNivel = [...new Set(
            alunos.filter((aluno) => !aluno.nivel_id).map((aluno) => aluno.classe).filter(Boolean)
        )];

        return res.json({
            success: true,
            dados: {
                data_limite: dataLimite,
                ano_letivo: ano.ano_nome,
                ano_inicio: inicioAno,
                ano_fim: fimAno,
                niveis: niveisResult.rows,
                polos: polosResult.rows,
                turmas: turmasResult.rows,
                itens: items,
                classes_sem_nivel: classesSemNivel,
                total_alunos: selecionados.length,
                alunos_com_divida: alunosEmAtraso.length,
                total_em_divida: totalEmDivida,
                alunos: alunosEmAtraso
            }
        });
    } catch (error) {
        console.error('Erro ao calcular pagamentos em atraso:', error);
        return res.status(500).json({ success: false, message: 'Erro ao calcular pagamentos em atraso.' });
    }
});

// ============================================================
// ROTA: LISTAR TURMAS DA ESCOLA
// GET /api/v1/tesouraria/turmas
// ============================================================
router.get('/turmas', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const resultado = await db.query(
            `SELECT id, nome, classe, turno FROM turmas WHERE escola_id = $1 AND ativo = true ORDER BY classe ASC, nome ASC`,
            [escolaId]
        );
        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error("Erro ao carregar turmas:", error);
        return res.status(500).json({ success: false, message: "Erro ao carregar turmas." });
    }
});

// ============================================================
// ROTA: LISTAR ALUNOS ATIVOS COM DETALHES COMPLETOS
// GET /api/v1/tesouraria/alunos-ativos
// ============================================================
router.get('/alunos-ativos', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { ano_letivo_id } = req.query;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (ano_letivo_id && !UUID_PATTERN.test(ano_letivo_id)) {
            return res.status(400).json({ success: false, message: 'Identificador do ano letivo inválido.' });
        }

        const query = `
            SELECT 
                m.id AS matricula_id,
                m.numero_matricula,
                COALESCE(m.ano_letivo_id, t.ano_letivo_id) AS ano_letivo_id,
                m.polo_id,
                u.nome,
                a.apelido,
                u.email,
                t.id AS turma_id,
                t.nome AS turma_nome,
                t.classe,
                al.ano_nome,
                a.endereco_morada AS morada,
                encarregado.nome AS encarregado_nome,
                encarregado.telefone AS encarregado_telefone,
                COALESCE(medias.mf_geral, 0) AS media_final,
                CASE WHEN COALESCE(medias.mf_geral, 0) >= 10 THEN 'Aprovado' ELSE 'Em Curso' END AS situacao
            FROM matriculas m
            JOIN alunos a ON a.id = m.aluno_id
            JOIN utilizadores u ON u.id = a.utilizador_id
            LEFT JOIN turmas t ON t.id = m.turma_id
            LEFT JOIN anos_letivos al ON al.id = COALESCE(m.ano_letivo_id, t.ano_letivo_id)
            LEFT JOIN LATERAL (
                SELECT ue.nome, ue.telefone 
                FROM encarregado_alunos ea 
                JOIN utilizadores ue ON ue.id = ea.utilizador_id 
                WHERE ea.aluno_id = a.id 
                ORDER BY ea.contacto_principal DESC, ea.criado_em DESC 
                LIMIT 1
            ) encarregado ON true
            LEFT JOIN LATERAL (
                SELECT ROUND(AVG(nt.mf), 2) AS mf_geral
                FROM notas_trimestrais nt
                WHERE nt.matricula_id = m.id
            ) medias ON true
            WHERE m.escola_id = $1
              AND m.estado = 'ativa'
              AND ($2::uuid IS NULL OR COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2)
            ORDER BY u.nome ASC;
        `;
        const resultado = await db.query(query, [escolaId, ano_letivo_id || null]);
        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error("Erro ao listar alunos ativos para tesouraria:", error);
        return res.status(500).json({ success: false, message: "Erro ao carregar alunos ativos." });
    }
});

// ============================================================
// ROTA: REGISTAR NOVO PAGAMENTO NA TESOURARIA
// POST /api/v1/tesouraria/pagamentos
// ============================================================
router.post('/pagamentos', verificarAutenticacao, async (req, res) => {
    let client;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const utilizadorId = req.user?.id;

        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }
        if (!podeGerirConfiguracaoTesouraria(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Tesouraria ou a Direção pode registar pagamentos.' });
        }

        const { 
            tipo_registo, 
            matricula_id, 
            aluno_id,
            classe: classeSelecionada,
            ano_letivo_id,
            nome_candidato, 
            referencia_banco, 
            banco_origem, 
            valor, 
            propina_taxa_id, 
            data_pagamento, 
            observacoes 
        } = req.body || {};

        if (!['aluno_registado', 'candidato_novo'].includes(tipo_registo)) {
            return res.status(400).json({ success: false, message: 'Tipo de registo inválido.' });
        }
        if (!UUID_PATTERN.test(ano_letivo_id || '')) {
            return res.status(400).json({ success: false, message: 'Selecione um ano letivo válido.' });
        }

        const valorPagamento = Number(valor);
        const referencia = typeof referencia_banco === 'string' ? referencia_banco.trim() : '';
        const candidato = typeof nome_candidato === 'string' ? nome_candidato.trim() : '';
        let nomeCandidatoRegistado = null;
        const banco = typeof banco_origem === 'string' ? banco_origem.trim() : '';
        if (!referencia || referencia.length > 100) {
            return res.status(400).json({ success: false, message: 'A referência do pagamento é obrigatória e deve ter até 100 caracteres.' });
        }
        if (!Number.isFinite(valorPagamento) || valorPagamento <= 0) {
            return res.status(400).json({ success: false, message: 'O valor do pagamento deve ser superior a zero.' });
        }
        if (!dataIsoValida(data_pagamento)) {
            return res.status(400).json({ success: false, message: 'Indique uma data de pagamento válida no formato AAAA-MM-DD.' });
        }
        if (banco.length > 100) {
            return res.status(400).json({ success: false, message: 'O método de pagamento deve ter até 100 caracteres.' });
        }
        if (observacoes !== undefined &&
            (typeof observacoes !== 'string' || observacoes.length > 2000)) {
            return res.status(400).json({ success: false, message: 'As observações devem ter até 2000 caracteres.' });
        }

        if (tipo_registo === 'aluno_registado' && !UUID_PATTERN.test(matricula_id || '')) {
            return res.status(400).json({ success: false, message: 'Selecione uma matrícula válida para o aluno registado.' });
        }

        if (tipo_registo === 'candidato_novo' &&
            (typeof classeSelecionada !== 'string' || !classeSelecionada.trim() || classeSelecionada.trim().length > 100)) {
            return res.status(400).json({ success: false, message: 'Selecione a classe do pagamento.' });
        }

        if (!UUID_PATTERN.test(propina_taxa_id || '')) {
            return res.status(400).json({ success: false, message: 'Selecione um item de pagamento válido.' });
        }

        client = await db.connect();
        await client.query('BEGIN');

        const anoDaEscola = await client.query(
            `SELECT ano_letivo_id
             FROM escola_anos_letivos
             WHERE escola_id = $1 AND ano_letivo_id = $2
             FOR SHARE`,
            [escolaId, ano_letivo_id]
        );
        if (!anoDaEscola.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'O ano letivo selecionado não pertence a esta escola.' });
        }

        if (tipo_registo === 'candidato_novo') {
            const prazoAberto = await client.query(
                `SELECT 1
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
            if (!prazoAberto.rowCount) {
                await client.query('ROLLBACK');
                return res.status(423).json({ success: false, message: 'O período de matrícula deste ano letivo está fechado.' });
            }

            if (candidato.length > 200) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'O nome de referência deve ter até 200 caracteres.' });
            }
            nomeCandidatoRegistado = candidato || null;

            const classeExiste = await client.query(
                `SELECT 1 FROM turmas
                 WHERE escola_id = $1 AND ano_letivo_id = $2
                   AND LOWER(BTRIM(classe)) = LOWER(BTRIM($3))
                 LIMIT 1 FOR SHARE`,
                [escolaId, ano_letivo_id, classeSelecionada.trim()]
            );
            if (!classeExiste.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'A classe selecionada não existe neste ano letivo da escola.' });
            }
        }

        let classePagamento = tipo_registo === 'candidato_novo' ? classeSelecionada.trim() : null;
        if (tipo_registo === 'aluno_registado') {
            const matriculaValida = await client.query(
                `SELECT t.classe
                 FROM matriculas m
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 WHERE m.id = $1
                   AND m.escola_id = $2
                   AND m.estado = 'ativa'
                   AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $3
                 FOR SHARE OF m`,
                [matricula_id, escolaId, ano_letivo_id]
            );
            if (!matriculaValida.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'A matrícula selecionada não está ativa ou não pertence a esta escola.' });
            }
            classePagamento = matriculaValida.rows[0].classe;
        }

        const itemPagamento = tipo_registo === 'candidato_novo'
            ? await client.query(
                `SELECT pt.id, pt.tipo, ptc.valor AS valor_configurado
                 FROM propinas_taxas pt
                 JOIN propinas_taxas_classes ptc
                   ON ptc.propina_taxa_id = pt.id AND ptc.escola_id = pt.escola_id
                 WHERE pt.id = $1 AND pt.escola_id = $2 AND pt.ativa = true
                   AND LOWER(BTRIM(ptc.classe)) = LOWER(BTRIM($3))
                   AND ptc.ano_letivo_id = $4
                 FOR SHARE OF pt, ptc`,
                [propina_taxa_id, escolaId, classePagamento, ano_letivo_id]
            )
            : await client.query(
                `SELECT pt.id, pt.tipo,
                        ptc.valor AS valor_configurado,
                        ptc.valor IS NOT NULL AS preco_definido_por_classe
                 FROM propinas_taxas pt
                 LEFT JOIN matriculas m
                   ON m.id = $3 AND m.escola_id = pt.escola_id
                 LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                 LEFT JOIN propinas_taxas_classes ptc
                   ON ptc.propina_taxa_id = pt.id AND ptc.escola_id = pt.escola_id
                  AND LOWER(BTRIM(ptc.classe)) = LOWER(BTRIM(t.classe))
                  AND ptc.ano_letivo_id = $4
                 WHERE pt.id = $1 AND pt.escola_id = $2 AND pt.ativa = true
                   AND ptc.valor IS NOT NULL
                 FOR SHARE OF pt`,
                [propina_taxa_id, escolaId, matricula_id, ano_letivo_id]
            );
        if (itemPagamento.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: tipo_registo === 'candidato_novo'
                ? 'Não existe um preço configurado pela Direção para esta classe e ano letivo.'
                : 'O item selecionado não está ativo ou não pertence a esta escola.' });
        }
        if (tipo_registo === 'candidato_novo' &&
            Math.round(valorPagamento * 100) !== Math.round(Number(itemPagamento.rows[0].valor_configurado) * 100)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: `O valor deve corresponder ao preço definido pela Direção para esta classe (${Number(itemPagamento.rows[0].valor_configurado).toLocaleString('pt-PT')} CFA).`
            });
        }
        if (tipo_registo === 'aluno_registado' &&
            itemPagamento.rows[0].preco_definido_por_classe &&
            Math.round(valorPagamento * 100) !== Math.round(Number(itemPagamento.rows[0].valor_configurado) * 100)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: `O valor deve corresponder ao preço definido pela Direção para a classe e ano letivo selecionados (${Number(itemPagamento.rows[0].valor_configurado).toLocaleString('pt-PT')} CFA).`
            });
        }

        const codigoTalao = tipo_registo === 'candidato_novo'
            ? `TAL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
            : null;
        const queryInsert = `
            INSERT INTO tesouraria_pagamentos (
                escola_id, ano_letivo_id, tipo_registo, matricula_id, aluno_id, polo_id, classe, nome_candidato, codigo_talao,
                referencia_banco, banco_origem, valor, valor_configurado, propina_taxa_id, 
                data_pagamento, observacoes, registado_por, estado
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'aprovado')
            RETURNING *;
        `;

        const resultado = await client.query(queryInsert, [
            escolaId,
            ano_letivo_id,
            tipo_registo,
            tipo_registo === 'aluno_registado' ? matricula_id : null,
            null,
            null,
            classePagamento,
            tipo_registo === 'candidato_novo' ? nomeCandidatoRegistado : null,
            codigoTalao,
            referencia,
            banco || 'BAO',
            valorPagamento,
            tipo_registo === 'candidato_novo' ? itemPagamento.rows[0].valor_configurado : null,
            propina_taxa_id,
            data_pagamento,
            observacoes || null,
            utilizadorId
        ]);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Pagamento registado com sucesso.',
            numero_recibo: resultado.rows[0].referencia_banco,
            codigo_talao: resultado.rows[0].codigo_talao,
            data: resultado.rows[0]
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error("Erro ao registar pagamento na tesouraria:", error);
        if (error.code === '23505') {
            return res.status(400).json({ success: false, message: 'Esta referência de banco / ID de recibo já se encontra registada no sistema.' });
        }
        return res.status(500).json({ success: false, message: 'Erro interno ao registar pagamento.' });
    } finally {
        client?.release();
    }
});

// ============================================================
// ROTA: LISTAR PAGAMENTOS DA TESOURARIA (Com filtros e abas de período)
// GET /api/v1/tesouraria/pagamentos
// ============================================================
router.get('/pagamentos/talao/buscar', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const papel = String(req.contaAtiva?.papel_norm || req.contaAtiva?.papel || '')
            .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!escolaId || !(req.user?.isOwner === true || [
            'direcao',
            'secretaria',
            'secretario',
            'secretaria escolar',
            'secretario escolar'
        ].includes(papel))) {
            return res.status(403).json({ success: false, message: 'Apenas a Secretaria ou a Direção pode pesquisar talões.' });
        }

        const termo = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
        if (termo.length < 2 || termo.length > 100) {
            return res.status(400).json({ success: false, message: 'Informe pelo menos 2 caracteres para pesquisar pagamentos.' });
        }

        const resultado = await db.query(
            `SELECT tp.codigo_talao, tp.valor,
                    (tp.matricula_id IS NOT NULL OR tp.aluno_id IS NOT NULL OR EXISTS (
                      SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                      WHERE alocacao.pagamento_id = tp.id
                    )) AS utilizado
             FROM tesouraria_pagamentos tp
             WHERE tp.escola_id = $1 AND tp.codigo_talao IS NOT NULL
               AND tp.codigo_talao ILIKE $2
             ORDER BY (tp.matricula_id IS NULL AND tp.aluno_id IS NULL) DESC, tp.criado_em DESC
             LIMIT 20`,
            [escolaId, `%${termo}%`]
        );

        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error('Erro ao pesquisar talões:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível pesquisar talões.' });
    }
});

router.get('/pagamentos/talao/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId || !podeVincularTalaoSecretaria(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Secretaria ou a Direção pode validar talões.' });
        }

        const codigo = String(req.params.codigo || '').trim().toUpperCase();
        const codigoTalaoValido = /^TAL-[A-F0-9]{16}$/.test(codigo);
        const codigoMovimentoValido = /^(?:REC-MAO-\d+-\d{3}|ENT-\d{8}-[A-F0-9]{8})$/.test(codigo);
        if (!codigoTalaoValido && !codigoMovimentoValido) {
            return res.status(400).json({ success: false, message: 'Use um ID de talão válido emitido pela Tesouraria.' });
        }

        const resultado = codigoTalaoValido
            ? await db.query(
                `SELECT tp.codigo_talao, tp.valor,
                        (tp.matricula_id IS NOT NULL OR tp.aluno_id IS NOT NULL OR EXISTS (
                          SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                          WHERE alocacao.pagamento_id = tp.id
                        )) AS utilizado
                 FROM tesouraria_pagamentos tp
                 WHERE tp.escola_id = $1 AND tp.codigo_talao = $2`,
                [escolaId, codigo]
            )
            : await db.query(
                `SELECT tm.referencia AS codigo_talao, tm.valor,
                        EXISTS (
                          SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                          WHERE alocacao.movimento_id = tm.id
                        ) AS utilizado
                 FROM tesouraria_movimentos tm
                 WHERE tm.escola_id = $1 AND tm.referencia = $2 AND tm.tipo = 'entrada'`,
                [escolaId, codigo]
            );
        if (!resultado.rowCount) {
            return res.status(404).json({ success: false, message: 'Este ID de talão não foi registado nesta escola.' });
        }

        return res.json({ success: true, dados: resultado.rows[0] });
    } catch (error) {
        console.error('Erro ao validar talão:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível validar o ID do talão.' });
    }
});

router.get('/pagamentos/talao-alunos', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { ano_letivo_id: anoLetivoId } = req.query;
        const classe = typeof req.query.classe === 'string' ? req.query.classe.trim() : '';
        const termo = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
        if (!escolaId || !podeVincularTalaoSecretaria(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Secretaria ou a Direção pode pesquisar alunos.' });
        }
        if (!UUID_PATTERN.test(anoLetivoId || '') || !classe || classe.length > 100 ||
            termo.length < 2 || termo.length > 100) {
            return res.status(400).json({ success: false, message: 'Selecione o ano letivo e a classe e informe pelo menos 2 caracteres de pesquisa.' });
        }

        const resultado = await db.query(
            `SELECT m.id AS matricula_id, m.aluno_id, m.numero_matricula,
                    COALESCE(m.ano_letivo_id, t.ano_letivo_id) AS ano_letivo_id,
                    m.polo_id, cn.nivel_id,
                    TRIM(CONCAT_WS(' ', u.nome, a.apelido)) AS nome,
                    u.login_id, u.telefone, u.email, t.classe
             FROM matriculas m
             JOIN alunos a ON a.id = m.aluno_id
             JOIN utilizadores u ON u.id = a.utilizador_id
             LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             LEFT JOIN tesouraria_classes_niveis cn
               ON cn.escola_id = m.escola_id
              AND LOWER(BTRIM(cn.classe)) = LOWER(BTRIM(t.classe))
             WHERE m.escola_id = $1 AND m.estado = 'ativa'
               AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $2
               AND LOWER(BTRIM(t.classe)) = LOWER(BTRIM($3))
               AND (
                 u.nome ILIKE $4 OR a.apelido ILIKE $4
                 OR m.id::text ILIKE $4 OR m.numero_matricula ILIKE $4
                 OR u.login_id ILIKE $4 OR u.telefone ILIKE $4
                 OR u.email ILIKE $4 OR a.id::text ILIKE $4
               )
             ORDER BY u.nome, a.apelido, m.numero_matricula
             LIMIT 25`,
            [escolaId, anoLetivoId, classe, `%${termo}%`]
        );
        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error('Erro ao pesquisar alunos para associar um talão:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível pesquisar alunos.' });
    }
});

router.post('/pagamentos/talao/:codigo/alocacoes', verificarAutenticacao, async (req, res) => {
    let client;
    let transacaoAberta = false;
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId || !podeVincularTalaoSecretaria(req)) {
            return res.status(403).json({ success: false, message: 'Apenas a Secretaria ou a Direção pode associar talões a alunos.' });
        }

        const codigo = String(req.params.codigo || '').trim().toUpperCase();
        const { matricula_id: matriculaId, ano_letivo_id: anoLetivoId, classe: classeSelecionada, alocacoes } = req.body || {};
        const codigoTalaoValido = /^TAL-[A-F0-9]{16}$/.test(codigo);
        const codigoMovimentoValido = /^(?:REC-MAO-\d+-\d{3}|ENT-\d{8}-[A-F0-9]{8})$/.test(codigo);
        if ((!codigoTalaoValido && !codigoMovimentoValido) ||
            !UUID_PATTERN.test(matriculaId || '') ||
            !UUID_PATTERN.test(anoLetivoId || '') ||
            typeof classeSelecionada !== 'string' || !classeSelecionada.trim() || classeSelecionada.trim().length > 100 ||
            !Array.isArray(alocacoes) || alocacoes.length < 1 || alocacoes.length > 25) {
            return res.status(400).json({ success: false, message: 'Informe um talão, matrícula, ano letivo, ramo e parcelas válidos.' });
        }

        const itensIds = [];
        let totalAlocadoCentimos = 0;
        for (const alocacao of alocacoes) {
            const valor = Number(alocacao?.valor);
            const valorCentimos = Math.round(valor * 100);
            if (!UUID_PATTERN.test(alocacao?.propina_taxa_id || '') ||
                !Number.isFinite(valor) || valor <= 0 || valor > 999999999999.99 ||
                Math.abs(valor * 100 - valorCentimos) > 0.000001 ||
                itensIds.includes(alocacao.propina_taxa_id)) {
                return res.status(400).json({ success: false, message: 'Cada parcela deve indicar um item diferente e um montante positivo com até 2 casas decimais.' });
            }
            itensIds.push(alocacao.propina_taxa_id);
            totalAlocadoCentimos += valorCentimos;
        }

        client = await db.connect();
        await client.query('BEGIN');
        transacaoAberta = true;

        let pagamento = null;
        let movimentoManual = null;
        if (codigoTalaoValido) {
            const pagamentoResult = await client.query(
                `SELECT id, valor, matricula_id, aluno_id,
                        EXISTS (
                          SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                          WHERE alocacao.pagamento_id = tesouraria_pagamentos.id
                        ) AS ja_alocado
                 FROM tesouraria_pagamentos
                 WHERE escola_id = $1 AND codigo_talao = $2
                 FOR UPDATE`,
                [escolaId, codigo]
            );
            if (!pagamentoResult.rowCount) {
                await client.query('ROLLBACK');
                transacaoAberta = false;
                return res.status(404).json({ success: false, message: 'Este ID de talão não foi registado nesta escola.' });
            }
            pagamento = pagamentoResult.rows[0];
            if (pagamento.matricula_id || pagamento.aluno_id || pagamento.ja_alocado) {
                await client.query('ROLLBACK');
                transacaoAberta = false;
                return res.status(409).json({ success: false, message: 'Este talão já está associado a um aluno.' });
            }
        } else {
            const movimentoResult = await client.query(
                `SELECT tm.id, tm.valor, tm.tipo,
                        EXISTS (
                          SELECT 1 FROM tesouraria_pagamentos_alocacoes alocacao
                          WHERE alocacao.movimento_id = tm.id
                        ) AS ja_alocado
                 FROM tesouraria_movimentos tm
                 WHERE tm.escola_id = $1 AND tm.referencia = $2
                 FOR UPDATE`,
                [escolaId, codigo]
            );
            if (!movimentoResult.rowCount) {
                await client.query('ROLLBACK');
                transacaoAberta = false;
                return res.status(404).json({ success: false, message: 'Este ID não foi registado nesta escola.' });
            }
            movimentoManual = movimentoResult.rows[0];
            if (movimentoManual.tipo !== 'entrada') {
                await client.query('ROLLBACK');
                transacaoAberta = false;
                return res.status(400).json({ success: false, message: 'Só é possível associar talões que correspondam a uma entrada de dinheiro.' });
            }
            if (movimentoManual.ja_alocado) {
                await client.query('ROLLBACK');
                transacaoAberta = false;
                return res.status(409).json({ success: false, message: 'Este talão manual já está associado a uma conta de aluno.' });
            }
        }

        const valorTalao = Number(pagamento?.valor || movimentoManual?.valor);
        if (totalAlocadoCentimos !== Math.round(valorTalao * 100)) {
            await client.query('ROLLBACK');
            transacaoAberta = false;
            return res.status(400).json({ success: false, message: 'A soma das parcelas tem de corresponder exatamente ao valor do talão.' });
        }

        const matriculaResult = await client.query(
            `SELECT m.id, m.aluno_id, COALESCE(m.polo_id, t.polo_id) AS polo_id,
                    t.classe, cn.nivel_id,
                    COALESCE(m.ano_letivo_id, t.ano_letivo_id) AS ano_letivo_id
             FROM matriculas m
             LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             LEFT JOIN tesouraria_classes_niveis cn
               ON cn.escola_id = m.escola_id
              AND LOWER(BTRIM(cn.classe)) = LOWER(BTRIM(t.classe))
             WHERE m.id = $1 AND m.escola_id = $2 AND m.estado = 'ativa'
               AND COALESCE(m.ano_letivo_id, t.ano_letivo_id) = $3
               AND LOWER(BTRIM(t.classe)) = LOWER(BTRIM($4))
             FOR UPDATE OF m`,
            [matriculaId, escolaId, anoLetivoId, classeSelecionada.trim()]
        );
        if (!matriculaResult.rowCount) {
            await client.query('ROLLBACK');
            transacaoAberta = false;
            return res.status(400).json({ success: false, message: 'A matrícula selecionada não está ativa nesta classe e ano letivo.' });
        }
        const matricula = matriculaResult.rows[0];
        const itensResult = await client.query(
            `SELECT pt.id
             FROM propinas_taxas pt
             JOIN propinas_taxas_classes ptc
               ON ptc.propina_taxa_id = pt.id AND ptc.escola_id = pt.escola_id
             WHERE pt.escola_id = $1 AND pt.ativa = true
               AND pt.id = ANY($2::uuid[])
               AND LOWER(BTRIM(ptc.classe)) = LOWER(BTRIM($3))
               AND ptc.ano_letivo_id = $4
             FOR SHARE OF pt, ptc`,
            [escolaId, itensIds, matricula.classe, anoLetivoId]
        );
        if (itensResult.rowCount !== itensIds.length) {
            await client.query('ROLLBACK');
            transacaoAberta = false;
            return res.status(400).json({ success: false, message: 'Um ou mais itens não estão configurados para esta classe e ano letivo.' });
        }
        const niveisResult = await client.query(
            `SELECT propina_taxa_id, nivel_id
             FROM propinas_taxas_niveis
             WHERE propina_taxa_id = ANY($1::uuid[])`,
            [itensIds]
        );
        const niveisPorItem = new Map();
        for (const nivel of niveisResult.rows) {
            const niveis = niveisPorItem.get(nivel.propina_taxa_id) || [];
            niveis.push(nivel.nivel_id);
            niveisPorItem.set(nivel.propina_taxa_id, niveis);
        }
        if (itensIds.some((itemId) => {
            const niveisPermitidos = niveisPorItem.get(itemId) || [];
            return niveisPermitidos.length &&
                (!matricula.nivel_id || !niveisPermitidos.includes(matricula.nivel_id));
        })) {
            await client.query('ROLLBACK');
            transacaoAberta = false;
            return res.status(400).json({ success: false, message: 'Um ou mais itens não se aplicam ao nível de ensino do aluno.' });
        }

        for (const alocacao of alocacoes) {
            await client.query(
                `INSERT INTO tesouraria_pagamentos_alocacoes (
                   pagamento_id, movimento_id, escola_id, matricula_id, aluno_id,
                   propina_taxa_id, ano_letivo_id, polo_id, classe, registado_por, valor
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    pagamento?.id || null, movimentoManual?.id || null, escolaId,
                    matricula.id, matricula.aluno_id, alocacao.propina_taxa_id,
                    anoLetivoId, matricula.polo_id, matricula.classe,
                    req.user?.id || null, Number(alocacao.valor)
                ]
            );
        }
        if (pagamento) {
            await client.query(
                `UPDATE tesouraria_pagamentos
                 SET tipo_registo = 'aluno_registado',
                     matricula_id = $1,
                     aluno_id = $2,
                     atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = $3 AND escola_id = $4`,
                [matricula.id, matricula.aluno_id, pagamento.id, escolaId]
            );
        }
        await client.query('COMMIT');
        transacaoAberta = false;
        return res.status(201).json({
            success: true,
            message: 'Talão associado à conta do aluno.',
            dados: {
                codigo_talao: codigo,
                matricula_id: matricula.id,
                valor_alocado: valorTalao,
                origem: movimentoManual ? 'movimento_manual' : 'pagamento',
                alocacoes
            }
        });
    } catch (error) {
        if (client && transacaoAberta) {
            await client.query('ROLLBACK').catch((rollbackError) => {
                console.error('Erro ao reverter a associação do talão:', rollbackError);
            });
        }
        console.error('Erro ao associar talão à conta do aluno:', error);
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: 'O talão já possui uma parcela associada a um ou mais itens.' });
        }
        return res.status(500).json({
            success: false,
            message: error.code === '42P01'
                ? 'A estrutura de contas financeiras ainda não foi instalada. Aplique 20261107_tesouraria_z_contas_financeiras_alunos.sql e 20261109_precos_pagamento_por_classe.sql.'
                : 'Não foi possível associar o talão à conta do aluno.'
        });
    } finally {
        client?.release();
    }
});

router.get('/relatorio-anual', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { ano_letivo_id: anoLetivoIdQuery, mes } = req.query;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const [anosResult, escolaResult] = await Promise.all([
            db.query(
                `SELECT eal.ano_letivo_id AS id, al.ano_nome,
                        eal.data_inicio::text AS data_inicio,
                        eal.data_fim::text AS data_fim,
                        eal.ativo
                 FROM escola_anos_letivos eal
                 JOIN anos_letivos al ON al.id = eal.ano_letivo_id
                 WHERE eal.escola_id = $1
                   AND eal.data_inicio IS NOT NULL
                   AND eal.data_fim IS NOT NULL
                   AND eal.data_inicio <= eal.data_fim
                 ORDER BY eal.ativo DESC, eal.data_inicio DESC, al.ano_nome DESC`,
                [escolaId]
            ),
            db.query(`SELECT nome FROM escolas WHERE id = $1`, [escolaId])
        ]);
        const anosLetivos = anosResult.rows;
        const ano = anoLetivoIdQuery
            ? anosLetivos.find((item) => item.id === anoLetivoIdQuery)
            : anosLetivos.find((item) => item.ativo) || anosLetivos[0];
        if (anoLetivoIdQuery && !UUID_PATTERN.test(anoLetivoIdQuery)) {
            return res.status(400).json({ success: false, message: 'Identificador do ano letivo inválido.' });
        }
        if (anoLetivoIdQuery && !ano) {
            return res.status(404).json({ success: false, message: 'O ano letivo selecionado não pertence a esta escola ou não tem datas válidas.' });
        }

        const base = {
            escola_nome: escolaResult.rows[0]?.nome || 'Escola',
            anos_letivos: anosLetivos
        };
        if (!ano) {
            return res.json({ success: true, dados: { ...base, relatorio: null } });
        }
        if (mes !== undefined && (typeof mes !== 'string' || !/^\d{4}-\d{2}$/.test(mes))) {
            return res.status(400).json({ success: false, message: 'Mês de fecho inválido.' });
        }

        const inicioAno = String(ano.data_inicio).slice(0, 10);
        const fimAno = String(ano.data_fim).slice(0, 10);
        const mesAtual = mes
            ? mes
            : (() => {
                const hoje = new Date();
                const mesHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
                if (mesHoje >= inicioAno.slice(0, 7) && mesHoje <= fimAno.slice(0, 7)) return mesHoje;
                return fimAno.slice(0, 7);
            })();
        const dataMes = /^\d{4}-\d{2}$/.test(mesAtual) ? new Date(`${mesAtual}-01T00:00:00Z`) : null;
        if (!dataMes || Number.isNaN(dataMes.getTime()) || dataMes.toISOString().slice(0, 7) !== mesAtual) {
            return res.status(400).json({ success: false, message: 'Mês de fecho inválido.' });
        }
        const inicioMes = `${mesAtual}-01`;
        const ultimoDiaMes = new Date(Date.UTC(dataMes.getUTCFullYear(), dataMes.getUTCMonth() + 1, 0))
            .toISOString().slice(0, 10);
        if (ultimoDiaMes < inicioAno || inicioMes > fimAno) {
            return res.status(400).json({ success: false, message: 'O mês selecionado não pertence ao ano letivo.' });
        }
        const dataFim = ultimoDiaMes > fimAno ? fimAno : ultimoDiaMes;

        const resultado = await db.query(
            `WITH registos AS (
                SELECT tp.id, 'pagamento'::text AS origem_registo, 'entrada'::text AS tipo,
                       tp.data_pagamento AS data_registo, tp.criado_em,
                       COALESCE(tp.referencia_banco, '') AS referencia,
                       tp.codigo_talao, tp.banco_origem AS metodo,
                       COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.nome, a.apelido)), ''),
                                NULLIF(BTRIM(tp.nome_candidato), ''), 'Aluno não identificado') AS nome_responsavel,
                       COALESCE(pt.nome, 'Pagamento escolar') AS descricao,
                       m.numero_matricula, tp.valor, tp.estado
                FROM tesouraria_pagamentos tp
                LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
                LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
                LEFT JOIN alunos a ON a.id = COALESCE(m.aluno_id, tp.aluno_id)
                LEFT JOIN utilizadores u ON u.id = a.utilizador_id
                WHERE tp.escola_id = $1
                  AND (m.ano_letivo_id = $2 OR tp.ano_letivo_id = $2)
                  AND tp.data_pagamento BETWEEN $3::date AND $4::date

                UNION ALL

                SELECT tm.id, 'movimento_manual'::text AS origem_registo, tm.tipo,
                       tm.data_movimento AS data_registo, tm.criado_em,
                       tm.referencia, NULL::text AS codigo_talao, tm.metodo,
                       tm.destinatario AS nome_responsavel, tm.descricao,
                       NULL::text AS numero_matricula, tm.valor, 'registado'::text AS estado
                FROM tesouraria_movimentos tm
                WHERE tm.escola_id = $1
                  AND tm.ano_letivo_id = $2
                  AND tm.data_movimento BETWEEN $3::date AND $4::date
            )
            SELECT id, origem_registo, tipo, data_registo::text AS data_registo,
                   criado_em, referencia, codigo_talao, metodo, nome_responsavel,
                   descricao, numero_matricula, valor, estado
            FROM registos
            ORDER BY data_registo, criado_em, id`,
            [escolaId, ano.id, inicioAno, dataFim]
        );

        const totais = resultado.rows.reduce((acc, registo) => {
            const valor = Number(registo.valor || 0);
            acc.quantidade += 1;
            if (registo.tipo === 'saida') {
                acc.despesas += valor;
                acc.quantidade_despesas += 1;
            } else if (registo.estado === 'aprovado' || registo.estado === 'registado') {
                acc.receitas_confirmadas += valor;
                acc.quantidade_confirmadas += 1;
            } else if (registo.estado === 'pendente_aprovacao') {
                acc.receitas_pendentes += valor;
                acc.quantidade_pendentes += 1;
            } else if (registo.estado === 'flagged') {
                acc.receitas_sinalizadas += valor;
                acc.quantidade_sinalizadas += 1;
            }
            return acc;
        }, {
            despesas: 0,
            receitas_confirmadas: 0,
            receitas_pendentes: 0,
            receitas_sinalizadas: 0,
            quantidade: 0,
            quantidade_despesas: 0,
            quantidade_confirmadas: 0,
            quantidade_pendentes: 0,
            quantidade_sinalizadas: 0
        });
        const resultadoLiquido = totais.receitas_confirmadas - totais.despesas;
        const totalDebito = totais.despesas + Math.max(resultadoLiquido, 0);
        const totalCredito = totais.receitas_confirmadas + Math.max(-resultadoLiquido, 0);

        return res.json({
            success: true,
            dados: {
                ...base,
                relatorio: {
                    ano_letivo: ano,
                    data_inicio: inicioAno,
                    data_fim: dataFim,
                    mes: mesAtual,
                    registos: resultado.rows,
                    totais: {
                        ...totais,
                        resultado_liquido: resultadoLiquido,
                        total_debito: totalDebito,
                        total_credito: totalCredito
                    }
                }
            }
        });
    } catch (error) {
        console.error('Erro ao gerar demonstrativo anual da tesouraria:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível gerar o demonstrativo do ano letivo.' });
    }
});

router.get('/livro-caixa', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { periodo = 'hoje', data_inicio: dataInicio, data_fim: dataFim, tipo, estado, busca } = req.query;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const params = [escolaId];
        let paramIndex = 2;
        let intervalo = '';
        if (periodo === 'intervalo') {
            if (!dataIsoValida(dataInicio) || !dataIsoValida(dataFim) || dataInicio > dataFim) {
                return res.status(400).json({ success: false, message: 'Indique um intervalo de datas válido.' });
            }
            intervalo = ` AND registo.data_registo BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`;
            params.push(dataInicio, dataFim);
        } else if (periodo === 'hoje') {
            intervalo = ` AND registo.data_registo = CURRENT_DATE`;
        } else if (periodo === 'ultimos_7_dias') {
            intervalo = ` AND registo.data_registo >= CURRENT_DATE - INTERVAL '6 days' AND registo.data_registo <= CURRENT_DATE`;
        } else if (periodo === 'este_mes') {
            intervalo = ` AND registo.data_registo >= DATE_TRUNC('month', CURRENT_DATE)::date AND registo.data_registo <= CURRENT_DATE`;
        } else if (periodo === 'todos') {
            intervalo = '';
        } else {
            return res.status(400).json({ success: false, message: 'Período inválido.' });
        }

        let filtros = '';
        let filtrosTipo = '';
        if (tipo && tipo !== 'todos') {
            if (!['entrada', 'saida'].includes(tipo)) {
                return res.status(400).json({ success: false, message: 'Tipo de movimento inválido.' });
            }
            filtrosTipo = ` WHERE registo.tipo = $${paramIndex++}`;
            params.push(tipo);
        }
        if (estado) {
            if (!['aprovado', 'pendente_aprovacao', 'flagged', 'registado'].includes(estado)) {
                return res.status(400).json({ success: false, message: 'Estado inválido.' });
            }
            filtros += ` AND registo.estado = $${paramIndex++}`;
            params.push(estado);
        }
        if (typeof busca === 'string' && busca.trim()) {
            const termo = `%${busca.trim()}%`;
            filtros += ` AND (
                registo.referencia ILIKE $${paramIndex}
                OR COALESCE(registo.codigo_talao, '') ILIKE $${paramIndex}
                OR registo.nome_pagador ILIKE $${paramIndex}
                OR registo.descricao ILIKE $${paramIndex}
                OR COALESCE(registo.item_nome, '') ILIKE $${paramIndex}
                OR COALESCE(registo.numero_matricula, '') ILIKE $${paramIndex}
                OR COALESCE(registo.metodo, '') ILIKE $${paramIndex}
            )`;
            params.push(termo);
        }

        const paginacaoSolicitada = req.query.pagina !== undefined || req.query.por_pagina !== undefined;
        const pagina = paginacaoSolicitada ? Number(req.query.pagina || 1) : 1;
        const porPagina = paginacaoSolicitada ? Number(req.query.por_pagina || 25) : 0;
        if (paginacaoSolicitada &&
            (!Number.isInteger(pagina) || pagina < 1 ||
             !Number.isInteger(porPagina) || porPagina < 1 || porPagina > 25)) {
            return res.status(400).json({ success: false, message: 'A paginação deve indicar uma página válida e até 25 registos por página.' });
        }
        let limitePagina = '';
        if (paginacaoSolicitada) {
            limitePagina = ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(porPagina, (pagina - 1) * porPagina);
        }

        const resultado = await db.query(
            `WITH registos AS (
                SELECT tp.id, 'pagamento'::text AS origem_registo, 'entrada'::text AS tipo,
                       tp.data_pagamento AS data_registo, tp.criado_em,
                       COALESCE(tp.referencia_banco, '') AS referencia,
                       tp.codigo_talao, tp.banco_origem AS metodo,
                       COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.nome, a.apelido)), ''),
                                NULLIF(BTRIM(tp.nome_candidato), ''), 'Aluno não identificado') AS nome_pagador,
                       COALESCE(pt.nome, 'Pagamento escolar') AS descricao,
                       pt.nome AS item_nome, m.numero_matricula,
                       COALESCE(tp.classe, t.classe) AS classe,
                       tp.valor, tp.estado, tp.observacoes,
                       tp.tipo_registo, tp.nome_candidato,
                       COALESCE(u.nome, '') AS aluno_nome,
                       COALESCE(a.apelido, '') AS aluno_apelido
                FROM tesouraria_pagamentos tp
                LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
                LEFT JOIN matriculas m ON m.id = tp.matricula_id AND m.escola_id = tp.escola_id
                LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
                LEFT JOIN alunos a ON a.id = COALESCE(m.aluno_id, tp.aluno_id)
                LEFT JOIN utilizadores u ON u.id = a.utilizador_id
                WHERE tp.escola_id = $1

                UNION ALL

                SELECT tm.id, 'movimento_manual'::text AS origem_registo, tm.tipo,
                       tm.data_movimento AS data_registo, tm.criado_em,
                       tm.referencia, NULL::text AS codigo_talao, tm.metodo,
                       tm.destinatario AS nome_pagador, tm.descricao,
                       tm.descricao AS item_nome, NULL::text AS numero_matricula,
                       NULL::text AS classe,
                       tm.valor, 'registado'::text AS estado,
                       tm.observacoes, NULL::text AS tipo_registo,
                       tm.destinatario AS nome_candidato, ''::text AS aluno_nome,
                       ''::text AS aluno_apelido
                FROM tesouraria_movimentos tm
                WHERE tm.escola_id = $1
            )
            , filtrados AS (
                SELECT registo.*
                FROM registos AS registo
                WHERE TRUE ${intervalo} ${filtros}
            ),
            totais AS (
                SELECT COUNT(*)::int AS quantidade,
                       COUNT(*) FILTER (WHERE tipo = 'entrada')::int AS quantidade_entradas,
                       COUNT(*) FILTER (WHERE tipo = 'saida')::int AS quantidade_saidas,
                       COUNT(*) FILTER (WHERE tipo = 'entrada' AND estado = 'aprovado')::int AS quantidade_aprovadas,
                       COUNT(*) FILTER (WHERE tipo = 'entrada' AND estado = 'pendente_aprovacao')::int AS quantidade_pendentes,
                       COUNT(*) FILTER (WHERE tipo = 'entrada' AND estado = 'flagged')::int AS quantidade_sinalizadas,
                       COUNT(*) FILTER (WHERE tipo = 'entrada' AND estado = 'registado')::int AS quantidade_registadas,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0)::numeric AS total_entradas,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0)::numeric AS total_saidas,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada' AND estado = 'aprovado'), 0)::numeric AS entradas_aprovadas,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada' AND estado = 'pendente_aprovacao'), 0)::numeric AS entradas_pendentes,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada' AND estado = 'flagged'), 0)::numeric AS entradas_sinalizadas,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada' AND estado = 'registado'), 0)::numeric AS entradas_registadas,
                       COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0)::numeric AS saidas_registadas
                FROM filtrados
            ),
            filtrados_por_tipo AS (
                SELECT registo.*
                FROM filtrados AS registo
                ${filtrosTipo}
            ),
            total_pagina AS (
                SELECT COUNT(*)::int AS total_exibido FROM filtrados_por_tipo
            ),
            pagina AS (
                SELECT * FROM filtrados_por_tipo
                ORDER BY data_registo DESC, criado_em DESC
                ${limitePagina}
            )
            SELECT pagina.id, pagina.origem_registo, pagina.tipo,
                   pagina.data_registo::text AS data_pagamento, pagina.criado_em,
                   pagina.referencia AS referencia_banco, pagina.codigo_talao,
                   pagina.metodo AS banco_origem, pagina.nome_pagador, pagina.descricao,
                   pagina.item_nome, pagina.numero_matricula, pagina.classe, pagina.valor, pagina.estado,
                   pagina.observacoes, pagina.tipo_registo, pagina.nome_candidato,
                   pagina.aluno_nome, pagina.aluno_apelido,
                   totais.*, total_pagina.total_exibido
            FROM totais
            CROSS JOIN total_pagina
            LEFT JOIN pagina ON TRUE
            ORDER BY pagina.data_registo DESC NULLS LAST, pagina.criado_em DESC NULLS LAST`,
            params
        );
        const totais = resultado.rows[0] || {};
        const linhas = resultado.rows.filter((registo) => registo.id !== null);
        const totalEntradas = Number(totais.total_entradas || 0);
        const totalSaidas = Number(totais.total_saidas || 0);
        const entradasAprovadas = Number(totais.entradas_aprovadas || 0);
        const entradasPendentes = Number(totais.entradas_pendentes || 0);
        const entradasSinalizadas = Number(totais.entradas_sinalizadas || 0);
        const entradasRegistadas = Number(totais.entradas_registadas || 0);
        const saidasRegistadas = Number(totais.saidas_registadas || 0);
        const entradasConfirmadas = entradasAprovadas + entradasRegistadas;
        const saldoConfirmado = entradasConfirmadas - saidasRegistadas;
        const saldoIncluindoNaoValidadas = saldoConfirmado +
            entradasPendentes + entradasSinalizadas;

        const resposta = {
            success: true,
            dados: linhas.map(({
                quantidade,
                quantidade_entradas,
                quantidade_saidas,
                quantidade_aprovadas,
                quantidade_pendentes,
                quantidade_sinalizadas,
                quantidade_registadas,
                total_entradas,
                total_saidas,
                entradas_aprovadas,
                entradas_pendentes,
                entradas_sinalizadas,
                entradas_registadas,
                saidas_registadas,
                total_exibido,
                ...registo
            }) => registo),
            resumo: {
                total_entradas: totalEntradas,
                total_saidas: totalSaidas,
                saldo_liquido: totalEntradas - totalSaidas,
                entradas_aprovadas: entradasAprovadas,
                entradas_pendentes: entradasPendentes,
                entradas_sinalizadas: entradasSinalizadas,
                entradas_registadas: entradasRegistadas,
                entradas_confirmadas: entradasConfirmadas,
                saidas_registadas: saidasRegistadas,
                saldo_confirmado: saldoConfirmado,
                saldo_incluindo_nao_validadas: saldoIncluindoNaoValidadas,
                volume_validacao: entradasPendentes + entradasSinalizadas,
                quantidade: Number(totais.quantidade || 0),
                quantidade_entradas: Number(totais.quantidade_entradas || 0),
                quantidade_saidas: Number(totais.quantidade_saidas || 0),
                quantidade_aprovadas: Number(totais.quantidade_aprovadas || 0),
                quantidade_pendentes: Number(totais.quantidade_pendentes || 0),
                quantidade_sinalizadas: Number(totais.quantidade_sinalizadas || 0),
                quantidade_registadas: Number(totais.quantidade_registadas || 0),
                quantidade_saidas_registadas: Number(totais.quantidade_saidas || 0)
            }
        };
        if (paginacaoSolicitada) {
            resposta.paginacao = {
                pagina,
                por_pagina: porPagina,
                total_registos: Number(totais.total_exibido || 0),
                total_paginas: Math.ceil(Number(totais.total_exibido || 0) / porPagina)
            };
        }
        return res.json(resposta);
    } catch (error) {
        console.error('Erro ao carregar o livro-caixa da tesouraria:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível carregar o livro-caixa.' });
    }
});

router.get('/pagamentos/:id', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        const { id } = req.params;

        if (!escolaId || !UUID_PATTERN.test(id)) {
            return res.status(400).json({ success: false, message: 'Dados inválidos.' });
        }

        const resultado = await db.query(
            `SELECT
                tp.id,
                tp.tipo_registo,
                tp.matricula_id,
                tp.aluno_id,
                tp.polo_id,
                tp.ano_letivo_id,
                tp.nome_candidato,
                tp.referencia_banco,
                tp.codigo_talao,
                tp.banco_origem,
                tp.valor,
                tp.valor_configurado,
                tp.propina_taxa_id,
                COALESCE(tp.classe, t.classe) AS classe,
                pt.nome AS item_nome,
                pt.tipo AS item_tipo,
                tp.data_pagamento,
                tp.observacoes,
                tp.estado,
                tp.criado_em,
                tp.atualizado_em,
                m.numero_matricula,
                al.ano_nome,
                 p.nome AS polo_nome,
                 COALESCE(u.nome, '') AS aluno_nome,
                 COALESCE(a.apelido, '') AS aluno_apelido
             FROM tesouraria_pagamentos tp
             LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
             LEFT JOIN matriculas m ON m.id = tp.matricula_id
             LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
             LEFT JOIN anos_letivos al ON al.id = COALESCE(m.ano_letivo_id, tp.ano_letivo_id)
             LEFT JOIN alunos a ON a.id = COALESCE(m.aluno_id, tp.aluno_id)
             LEFT JOIN utilizadores u ON u.id = a.utilizador_id
             LEFT JOIN polos_escola p ON p.id = COALESCE(tp.polo_id, m.polo_id) AND p.escola_id = tp.escola_id
             WHERE tp.id = $1 AND tp.escola_id = $2`,
            [id, escolaId]
        );

        if (resultado.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Pagamento não encontrado.' });
        }

        return res.json({ success: true, dados: resultado.rows[0] });
    } catch (error) {
        console.error('Erro ao consultar detalhes do pagamento:', error);
        return res.status(500).json({ success: false, message: 'Erro interno ao consultar pagamento.' });
    }
});

router.get('/pagamentos', verificarAutenticacao, async (req, res) => {
    try {
        const escolaId = req.contaAtiva?.escola_id;
        if (!escolaId) {
            return res.status(403).json({ success: false, message: 'Escola ativa não identificada.' });
        }

        const { periodo = 'hoje', item_id, banco, busca, estado } = req.query;

        let query = `
            SELECT 
                tp.id,
                tp.tipo_registo,
                tp.matricula_id,
                tp.aluno_id,
                tp.polo_id,
                tp.ano_letivo_id,
                tp.nome_candidato,
                tp.referencia_banco,
                tp.codigo_talao,
                tp.banco_origem,
                tp.valor,
                tp.valor_configurado,
                tp.propina_taxa_id,
                COALESCE(tp.classe, t.classe) AS classe,
                pt.nome AS item_nome,
                pt.tipo AS item_tipo,
                tp.data_pagamento,
                tp.observacoes,
                tp.estado,
                tp.criado_em,
                tp.atualizado_em,
                m.numero_matricula,
                al.ano_nome,
                p.nome AS polo_nome,
                COALESCE(u.nome, '') AS aluno_nome,
                COALESCE(a.apelido, '') AS aluno_apelido
            FROM tesouraria_pagamentos tp
            LEFT JOIN propinas_taxas pt ON pt.id = tp.propina_taxa_id
            LEFT JOIN matriculas m ON m.id = tp.matricula_id
            LEFT JOIN turmas t ON t.id = m.turma_id AND t.escola_id = m.escola_id
            LEFT JOIN anos_letivos al ON al.id = COALESCE(m.ano_letivo_id, tp.ano_letivo_id)
            LEFT JOIN alunos a ON a.id = COALESCE(m.aluno_id, tp.aluno_id)
            LEFT JOIN utilizadores u ON u.id = a.utilizador_id
            LEFT JOIN polos_escola p ON p.id = COALESCE(tp.polo_id, m.polo_id) AND p.escola_id = tp.escola_id
            WHERE tp.escola_id = $1
        `;

        const params = [escolaId];
        let paramIndex = 2;

        // Filtro por Período (Abas)
        if (periodo === 'hoje') {
            query += ` AND tp.criado_em::date = CURRENT_DATE`;
        } else if (periodo === 'ultimos_7_dias') {
            query += ` AND tp.criado_em >= CURRENT_DATE - INTERVAL '7 days'`;
        } else if (periodo === 'este_mes') {
            query += ` AND DATE_TRUNC('month', tp.criado_em) = DATE_TRUNC('month', CURRENT_DATE)`;
        }

        // Filtros adicionais
        if (item_id && UUID_PATTERN.test(item_id)) {
            query += ` AND tp.propina_taxa_id = $${paramIndex++}`;
            params.push(item_id);
        }

        if (banco) {
            query += ` AND tp.banco_origem = $${paramIndex++}`;
            params.push(banco);
        }

        if (estado) {
            query += ` AND tp.estado = $${paramIndex++}`;
            params.push(estado);
        }

        if (busca && busca.trim() !== '') {
            query += ` AND (
                tp.codigo_talao ILIKE $${paramIndex}
                OR tp.referencia_banco ILIKE $${paramIndex}
                OR tp.nome_candidato ILIKE $${paramIndex}
                OR CONCAT_WS(' ', u.nome, a.apelido) ILIKE $${paramIndex}
                OR u.email ILIKE $${paramIndex}
                OR u.telefone ILIKE $${paramIndex}
                OR m.numero_matricula ILIKE $${paramIndex}
                OR pt.nome ILIKE $${paramIndex}
            )`;
            params.push(`%${busca.trim()}%`);
            paramIndex++;
        }

        query += ` ORDER BY tp.criado_em DESC;`;

        const resultado = await db.query(query, params);
        return res.json({ success: true, dados: resultado.rows });
    } catch (error) {
        console.error("Erro ao listar pagamentos:", error);
        return res.status(500).json({ success: false, message: "Erro interno ao listar pagamentos." });
    }
});

module.exports = router;