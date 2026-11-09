'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    BsBuilding, BsCalendar3, BsCalendarCheck, BsCashCoin,
    BsCheckCircle, BsExclamationTriangle, BsGeoAlt, BsKey,
    BsSliders, BsArrowClockwise, BsGear, BsPersonCircle, BsShieldCheck
} from 'react-icons/bs';
import { useGlobalAuth } from '@/utils/globalAuth';
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput';
import '../../../../styles/a7.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1`;

const DEFAULT_EVALUATION = {
    sistema_periodo: 'trimestres',
    escala_nota: '0-20',
    tipo_prova_final: 'trimestres',
    racio_continua: 50,
    racio_fixo: 50,
    nome_metrico_1: 'Prova 1',
    nome_metrico_2: 'Prova 2',
    nome_metrico_3: 'Prova 3',
    nome_metrico_4: 'Prova 4'
};

const METRICS = ['nome_metrico_1', 'nome_metrico_2', 'nome_metrico_3', 'nome_metrico_4'];

const SECTIONS = [
    { id: 'geral', title: 'Dados gerais', description: 'Identidade e contactos', icon: BsBuilding },
    { id: 'anos', title: 'Anos letivos', description: 'Calendário escolar', icon: BsCalendar3 },
    { id: 'matriculas', title: 'Matrículas', description: 'Prazos de inscrição', icon: BsCalendarCheck },
    { id: 'polos', title: 'Polos', description: 'Unidades escolares', icon: BsGeoAlt },
    { id: 'tesouraria', title: 'Tesouraria', description: 'Propinas e taxas', icon: BsCashCoin },
    { id: 'avaliacao', title: 'Avaliação', description: 'Períodos e notas', icon: BsSliders },
    { id: 'seguranca', title: 'Segurança', description: 'Palavra-passe', icon: BsKey }
];

const PAYMENT_TYPES = [
    ['propina', 'Propina'],
    ['matricula', 'Matrícula'],
    ['inscricao', 'Inscrição'],
    ['exame', 'Exame'],
    ['transporte', 'Transporte'],
    ['alimentacao', 'Alimentação'],
    ['outro', 'Outro']
];

const POLO_OPTIONS = [
    { value: 'SEDE', label: 'SEDE (níveis da escola)' },
    { value: 'RAM1', label: 'RAMO 1º Ciclo', pattern: /1(?:º|o)?\s*ciclo/ },
    { value: 'RAM2', label: 'RAMO 2º Ciclo', pattern: /2(?:º|o)?\s*ciclo/ },
    { value: 'RAM3', label: 'RAMO 3º Ciclo', pattern: /3(?:º|o)?\s*ciclo/ },
    { value: 'JARD', label: 'RAMO-JARDIM', pattern: /jardim|infantil/ },
    { value: 'RAML', label: 'RAMO-LICEU', pattern: /secundario|liceu/ },
    { value: 'FORM', label: 'FORMAÇÃO', pattern: /tecnico|profissional/ },
    { value: 'SUPR', label: 'ENSINO SUPERIOR', pattern: /superior|universidade/ }
];

function opcoesPoloParaNiveis(niveis) {
    const nomesNormalizados = (Array.isArray(niveis) ? niveis : [])
        .map((nome) => String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    if (!nomesNormalizados.length) return [];
    return POLO_OPTIONS.filter((option) => (
        option.value === 'SEDE' || nomesNormalizados.some((nome) => option.pattern.test(nome))
    ));
}

async function requestApi(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        credentials: 'include',
        cache: 'no-store',
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(`Resposta inesperada do servidor (HTTP ${response.status}).`);
    }
    const result = await response.json();
    if (!response.ok || result.success === false) {
        throw new Error(result.message || `Não foi possível concluir o pedido (HTTP ${response.status}).`);
    }
    return result;
}

function dataFormulario(data) {
    if (!data) return '';
    if (data instanceof Date) return data.toISOString().slice(0, 10);
    return String(data).slice(0, 10);
}

function estadoEdicaoPagamento(item, precoClasse = null) {
    return {
        nome: item.nome,
        valor: String(precoClasse?.valor ?? item.valor),
        tipo: item.tipo,
        periodicidade: item.periodicidade,
        obrigatorio: item.obrigatorio,
        ativa: item.ativa,
        data_vencimento: dataFormulario(precoClasse?.data_vencimento),
        ano_letivo_id: precoClasse?.ano_letivo_id || '',
        classe: precoClasse?.classe || '',
        nivel_ids: item.nivel_ids || [],
    };
}

function ConfigCard({ title, description, children }) {
    return (
        <section className="owner-config-panel">
            <header className="owner-config-panel-heading">
                <div>
                    <span className="owner-config-eyebrow">Configuração institucional</span>
                    <h2>{title}</h2>
                    {description && <p>{description}</p>}
                </div>
            </header>
            {children}
        </section>
    );
}

function ConfigField({ label, children }) {
    return (
        <div className="owner-config-field ce-field-group">
            <label>{label}</label>
            {children}
        </div>
    );
}

export default function ConfiguracoesDirecaoPage() {
    const { userInfo, setUserInfo } = useGlobalAuth();
    const [activeSection, setActiveSection] = useState('geral');
    const [schoolId, setSchoolId] = useState('');
    const [school, setSchool] = useState(null);
    const [availableBranchOptions, setAvailableBranchOptions] = useState([]);
    const [globalYears, setGlobalYears] = useState([]);
    const [schoolYears, setSchoolYears] = useState([]);
    const [enrollmentDeadlines, setEnrollmentDeadlines] = useState([]);
    const [branches, setBranches] = useState([]);
    const [paymentItems, setPaymentItems] = useState([]);
    const [paymentLevels, setPaymentLevels] = useState([]);
    const [paymentClasses, setPaymentClasses] = useState([]);
    const [editingPayment, setEditingPayment] = useState(null);
    const [paymentForm, setPaymentForm] = useState({
        nome: '', valor: '', tipo: 'propina', ano_letivo_id: '', classe: '',
        periodicidade: 'unica', obrigatorio: true, ativa: true,
        data_vencimento: '', nivel_ids: []
    });
    const paymentFormRef = useRef(null);
    const [evaluation, setEvaluation] = useState({ ...DEFAULT_EVALUATION });
    const [generalForm, setGeneralForm] = useState(null);
    const [schoolYearForm, setSchoolYearForm] = useState({ ano_letivo_id: '', data_inicio: '', data_fim: '', ativo: true });
    const [deadlineForm, setDeadlineForm] = useState({ anos_letivo_id: '', data_inicio: '', data_fim: '', ativo: true });
    const [branchForm, setBranchForm] = useState({ nome: '', codigo: 'SEDE', local: 'Bissau', endereco: '', telefone: '', ativo: true });
    const [editingSchoolYearId, setEditingSchoolYearId] = useState('');
    const [editingDeadlineId, setEditingDeadlineId] = useState('');
    const [editingBranchId, setEditingBranchId] = useState('');
    const [passwordForm, setPasswordForm] = useState({ senha_atual: '', nova_senha: '' });
    const [staffAccounts, setStaffAccounts] = useState([]);
    const [loadingStaffAccounts, setLoadingStaffAccounts] = useState(false);
    const [staffPasswordForm, setStaffPasswordForm] = useState({
        funcionario_id: '', nova_senha: '', confirmar_senha: ''
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState('');
    const [feedback, setFeedback] = useState(null);
    const pagamentosPorAno = useMemo(() => {
        const anos = new Map();
        const itensComPerfil = new Set();
        for (const item of paymentItems) {
            for (const profile of (item.classe_precos || []).filter((preco) => preco.ano_letivo_id)) {
                const anoId = String(profile.ano_letivo_id);
                const anoEscola = schoolYears.find((year) => String(year.ano_letivo_id || year.id) === anoId);
                const anoNome = profile.ano_nome || anoEscola?.ano_nome || 'Ano letivo';
                if (!anos.has(anoId)) {
                    anos.set(anoId, { id: anoId, nome: anoNome, classes: new Map() });
                }
                const ano = anos.get(anoId);
                if (!ano.classes.has(profile.classe)) {
                    ano.classes.set(profile.classe, []);
                }
                ano.classes.get(profile.classe).push({ item, profile });
                itensComPerfil.add(item.id);
            }
        }

        const compararAnos = (a, b) => {
            const anoA = Number(a.nome.match(/\d{4}/)?.[0] || 0);
            const anoB = Number(b.nome.match(/\d{4}/)?.[0] || 0);
            return anoB - anoA || b.nome.localeCompare(a.nome, 'pt');
        };

        return {
            anos: [...anos.values()]
                .map((ano) => ({
                    ...ano,
                    classes: [...ano.classes.entries()]
                        .sort(([classeA], [classeB]) => classeA.localeCompare(classeB, 'pt'))
                }))
                .sort(compararAnos),
            itensSemClasse: paymentItems.filter((item) => !itensComPerfil.has(item.id))
        };
    }, [paymentItems, schoolYears]);

    const loadSchoolSettings = useCallback(async (id, showLoader = true) => {
        if (!id) return;
        if (showLoader) setLoading(true);
        const endpoints = {
            school: { label: 'escola', path: `/owner/escolas/${encodeURIComponent(id)}/completa` },
            globalYears: { label: 'anos globais', path: '/owner/anos-letivos' },
            schoolYears: { label: 'anos da escola', path: `/escolas/escolas/${encodeURIComponent(id)}/anos-letivos` },
            deadlines: { label: 'prazos de matrícula', path: `/escolas/${encodeURIComponent(id)}/prazos-matricula` },
            branches: { label: 'polos', path: `/escolas/escolas/${encodeURIComponent(id)}/polos` },
            evaluation: { label: 'parâmetros de avaliação', path: `/escolas/escolas/${encodeURIComponent(id)}/parametros-avaliacao` },
            payments: { label: 'configurações de tesouraria', path: '/tesouraria/configuracoes' }
        };
        const endpointEntries = Object.entries(endpoints);
        const settledResults = await Promise.allSettled(
            endpointEntries.map(([, endpoint]) => requestApi(endpoint.path))
        );
        const errors = [];
        const results = Object.fromEntries(endpointEntries.map(([key, endpoint], index) => [
            key,
            { ...endpoint, result: settledResults[index] }
        ]));
        const value = (key) => {
            const { label, result } = results[key];
            if (result.status === 'rejected') {
                errors.push(`${label}: ${result.reason?.message || 'erro ao carregar'}`);
                return null;
            }
            return result.value;
        };

        const schoolResult = value('school');
        const yearsResult = value('globalYears');
        const schoolYearsResult = value('schoolYears');
        const deadlinesResult = value('deadlines');
        const branchesResult = value('branches');
        const evaluationResult = value('evaluation');
        const paymentResult = value('payments');

        if (schoolResult?.data) {
            const schoolData = schoolResult.data;
            setSchool(schoolData);
            const branchOptions = opcoesPoloParaNiveis(schoolData.niveis_ensino);
            setAvailableBranchOptions(branchOptions);
            setBranchForm((current) => ({
                ...current,
                codigo: branchOptions.some((option) => option.value === current.codigo)
                    ? current.codigo
                    : branchOptions[0]?.value || ''
            }));
            setGeneralForm({
                nome: schoolData.nome || schoolData.nome_escola || '',
                sigla: schoolData.sigla || '',
                cor_primaria: schoolData.cor_primaria || '#0284c7',
                motto: schoolData.motto || '',
                visao: schoolData.visao || '',
                sector: schoolData.sector || '',
                local: schoolData.local || '',
                endereco: schoolData.endereco || '',
                regime_periodo: schoolData.regime_periodo || ''
            });
        }
        if (yearsResult) setGlobalYears(Array.isArray(yearsResult.dados) ? yearsResult.dados : []);
        if (schoolYearsResult) setSchoolYears(Array.isArray(schoolYearsResult.dados) ? schoolYearsResult.dados : []);
        if (deadlinesResult) setEnrollmentDeadlines(Array.isArray(deadlinesResult.data) ? deadlinesResult.data : []);
        if (branchesResult) {
            const branchesData = Array.isArray(branchesResult.data) ? branchesResult.data : [];
            setBranches(branchesData);
        }
        if (evaluationResult) {
            setEvaluation({ ...DEFAULT_EVALUATION, ...(evaluationResult.data || {}) });
        }
        if (paymentResult) {
            const items = Array.isArray(paymentResult.dados?.itens) ? paymentResult.dados.itens : [];
            setPaymentItems(items);
            setPaymentLevels(Array.isArray(paymentResult.dados?.niveis) ? paymentResult.dados.niveis : []);
            setPaymentClasses([...new Set((paymentResult.dados?.classes || [])
                .map((item) => item.classe)
                .filter((classe) => typeof classe === 'string' && classe.trim()))]
                .sort((a, b) => a.localeCompare(b, 'pt')));
        }
        if (schoolYearsResult?.dados?.length) {
            const anoAtivo = schoolYearsResult.dados.find((ano) => ano.ativo);
            if (anoAtivo) {
                const anoId = String(anoAtivo.ano_letivo_id || anoAtivo.id);
                setPaymentForm((current) => ({ ...current, ano_letivo_id: anoId }));
            }
        }

        if (errors.length) {
            setFeedback({ type: 'error', text: `Algumas informações não foram carregadas: ${errors.join('; ')}` });
        }
        if (showLoader) setLoading(false);
        return errors.length === 0;
    }, []);

    useEffect(() => {
        let mounted = true;
        const identifyAndLoadSchool = async () => {
            try {
                const session = await requestApi('/auth/me');
                const id = session?.data?.conta_ativa?.escola_id;
                if (!id) throw new Error('Não foi encontrada uma escola ativa para esta conta.');
                if (!mounted) return;
                setSchoolId(id);
                await loadSchoolSettings(id);
            } catch (error) {
                if (mounted) {
                    setFeedback({ type: 'error', text: error.message || 'Não foi possível carregar a escola ativa.' });
                    setLoading(false);
                }
            }
        };
        void identifyAndLoadSchool();
        return () => { mounted = false; };
    }, [loadSchoolSettings]);

    useEffect(() => {
        if (activeSection !== 'seguranca' || !schoolId) return undefined;
        const controller = new AbortController();
        const carregarFuncionarios = async () => {
            try {
                setLoadingStaffAccounts(true);
                const result = await requestApi('/direcao/funcionarios-senhas', { signal: controller.signal });
                const list = Array.isArray(result.dados) ? result.dados : [];
                setStaffAccounts(list);
                setStaffPasswordForm((current) => ({
                    ...current,
                    funcionario_id: list.some((item) => item.funcionario_id === current.funcionario_id)
                        ? current.funcionario_id
                        : ''
                }));
            } catch (error) {
                if (error.name !== 'AbortError') {
                    setStaffAccounts([]);
                    setFeedback({ type: 'error', text: error.message || 'Não foi possível carregar os funcionários.' });
                }
            } finally {
                if (!controller.signal.aborted) setLoadingStaffAccounts(false);
            }
        };
        void carregarFuncionarios();
        return () => controller.abort();
    }, [activeSection, schoolId]);

    const performAction = async (key, action, successMessage, onSuccess) => {
        setSaving(key);
        setFeedback(null);
        try {
            const result = await action();
            const actionCompleted = onSuccess ? await onSuccess(result) : true;
            if (actionCompleted !== false) {
                setFeedback({ type: 'success', text: result.message || successMessage });
            }
            return result;
        } catch (error) {
            console.error(`Erro ao guardar ${key}:`, error);
            setFeedback({ type: 'error', text: error.message || 'Não foi possível guardar as alterações.' });
            return null;
        } finally {
            setSaving('');
        }
    };

    const refresh = async () => {
        setRefreshing(true);
        setFeedback(null);
        try {
            const session = await requestApi('/auth/me');
            const activeSchoolId = session?.data?.conta_ativa?.escola_id;
            if (!activeSchoolId) throw new Error('Escola ativa não encontrada.');
            setUserInfo(session.data);
            setSchoolId(activeSchoolId);
            const loaded = await loadSchoolSettings(activeSchoolId, false);
            if (loaded) setFeedback({ type: 'success', text: 'Configurações atualizadas com sucesso.' });
        } catch (error) {
            setFeedback({ type: 'error', text: error.message || 'Não foi possível atualizar.' });
        } finally {
            setRefreshing(false);
        }
    };

    const updateForm = (setter, field, value) => {
        setter((current) => ({ ...current, [field]: value }));
    };

    const saveGeneral = async (event) => {
        event.preventDefault();
        await performAction('geral', () => requestApi(
            `/escolas/${encodeURIComponent(schoolId)}/configuracoes`,
            { method: 'PUT', body: JSON.stringify(generalForm) }
        ), 'Dados gerais atualizados com sucesso.', (result) => {
            const updated = result.data;
            if (!updated) throw new Error('O servidor não confirmou os dados atualizados.');
            setSchool((current) => ({ ...current, ...updated, nome_escola: updated.nome }));
            setGeneralForm({
                nome: updated.nome || '',
                sigla: updated.sigla || '',
                cor_primaria: updated.cor_primaria || '#0284c7',
                motto: updated.motto || '',
                visao: updated.visao || '',
                sector: updated.sector || '',
                local: updated.local || '',
                endereco: updated.endereco || '',
                regime_periodo: updated.regime_periodo || ''
            });
            if (userInfo) {
                setUserInfo({ ...userInfo, conta_ativa: { ...userInfo.conta_ativa, escola_nome: updated.nome, escola_sigla: updated.sigla, cor_primaria: updated.cor_primaria } });
            }
        });
    };

    const addSchoolYear = async (event) => {
        event.preventDefault();
        const result = await performAction('ano-letivo', () => requestApi(
            editingSchoolYearId ? `/escolas/escolas/anos-letivos/${encodeURIComponent(editingSchoolYearId)}` : `/escolas/escolas/${encodeURIComponent(schoolId)}/anos-letivos`,
            { method: editingSchoolYearId ? 'PUT' : 'POST', body: JSON.stringify(schoolYearForm) }
        ), editingSchoolYearId ? 'Ano letivo atualizado com sucesso.' : 'Ano letivo associado com sucesso.');
        if (result) {
            setEditingSchoolYearId('');
            setSchoolYearForm({ ano_letivo_id: '', data_inicio: '', data_fim: '', ativo: true });
            await refresh();
        }
    };

    const addDeadline = async (event) => {
        event.preventDefault();
        const result = await performAction('prazo', () => requestApi(
            editingDeadlineId ? `/escolas/prazos-matricula/${encodeURIComponent(editingDeadlineId)}` : `/escolas/${encodeURIComponent(schoolId)}/prazos-matricula`,
            { method: editingDeadlineId ? 'PUT' : 'POST', body: JSON.stringify(deadlineForm) }
        ), editingDeadlineId ? 'Prazo atualizado com sucesso.' : 'Prazo de matrícula registado.');
        if (result) {
            setEditingDeadlineId('');
            setDeadlineForm({ anos_letivo_id: '', data_inicio: '', data_fim: '', ativo: true });
            await refresh();
        }
    };

    const addBranch = async (event) => {
        event.preventDefault();
        if (!availableBranchOptions.some((option) => option.value === branchForm.codigo)) {
            setFeedback({
                type: 'error',
                text: 'Selecione um ramo incluído nos níveis de ensino configurados pelo Owner.'
            });
            return;
        }
        const result = await performAction('polo', () => requestApi(
            editingBranchId ? `/escolas/polos/${encodeURIComponent(editingBranchId)}` : `/escolas/escolas/${encodeURIComponent(schoolId)}/polos`,
            { method: editingBranchId ? 'PUT' : 'POST', body: JSON.stringify(branchForm) }
        ), editingBranchId ? 'Polo atualizado com sucesso.' : 'Polo criado com sucesso.');
        if (result) {
            setEditingBranchId('');
            setBranchForm({ nome: '', codigo: 'SEDE', local: 'Bissau', endereco: '', telefone: '', ativo: true });
            await refresh();
        }
    };

    const addPaymentItem = async (event) => {
        event.preventDefault();
        const temAno = Boolean(paymentForm.ano_letivo_id);
        const temClasse = Boolean(paymentForm.classe);
        if (temAno !== temClasse || (!editingPayment && !temAno) ||
            (editingPayment?.origemAnoLetivoId && !temAno)) {
            setFeedback({ type: 'error', text: 'Selecione o ano letivo e a classe deste pagamento.' });
            return;
        }
        if (!Number.isFinite(Number(paymentForm.valor)) || Number(paymentForm.valor) < 0 ||
            temAno && Number(paymentForm.valor) <= 0 ||
            editingPayment && (!paymentForm.nome.trim() || paymentForm.nome.trim().length > 100)) {
            setFeedback({ type: 'error', text: 'Indique um nome e preço válidos.' });
            return;
        }
        if (temAno && !paymentForm.data_vencimento) {
            setFeedback({ type: 'error', text: 'Indique a data de vencimento para o ano e a classe selecionados.' });
            return;
        }
        const payload = {
            ...paymentForm,
            valor: Number(paymentForm.valor)
        };
        if (temAno) {
            payload.classe_precos = [{
                classe: paymentForm.classe,
                valor: Number(paymentForm.valor),
                data_vencimento: paymentForm.data_vencimento
            }];
        } else {
            delete payload.ano_letivo_id;
            delete payload.classe;
        }
        if (editingPayment?.origemAnoLetivoId) {
            payload.origem_ano_letivo_id = editingPayment.origemAnoLetivoId;
            payload.origem_classe = editingPayment.origemClasse;
        }
        const isEditing = Boolean(editingPayment);
        const result = await performAction(
            isEditing ? `item-${editingPayment.itemId}` : 'novo-item',
            () => requestApi(
                isEditing
                    ? `/tesouraria/propinas-taxas/${encodeURIComponent(editingPayment.itemId)}`
                    : '/tesouraria/propinas-taxas',
                { method: isEditing ? 'PUT' : 'POST', body: JSON.stringify(payload) }
            ),
            isEditing ? 'Item de pagamento atualizado com sucesso.' : 'Item de pagamento criado com sucesso.'
        );
        if (result?.data) {
            setEditingPayment(null);
            setPaymentForm({
                nome: '', valor: '', tipo: 'propina', ano_letivo_id: '', classe: '',
                periodicidade: 'unica', obrigatorio: true, ativa: true,
                data_vencimento: '', nivel_ids: []
            });
            await refresh();
        }
    };

    const editPaymentItem = (item, profile = null) => {
        setEditingPayment({
            itemId: item.id,
            origemAnoLetivoId: profile?.ano_letivo_id || '',
            origemClasse: profile?.classe || ''
        });
        setPaymentForm(estadoEdicaoPagamento(item, profile));
        paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const cancelPaymentEdit = () => {
        setEditingPayment(null);
        setPaymentForm({
            nome: '', valor: '', tipo: 'propina', ano_letivo_id: '', classe: '',
            periodicidade: 'unica', obrigatorio: true, ativa: true,
            data_vencimento: '', nivel_ids: []
        });
    };

    const removePaymentItem = async (itemId, itemNome, anoLetivoId, classe) => {
        const confirmado = window.confirm(
            `Apagar a configuração "${itemNome}"?\n\nConfigurações com pagamentos registados não podem ser apagadas para preservar o histórico financeiro.`
        );
        if (!confirmado) return;

        const query = anoLetivoId && classe
            ? `?ano_letivo_id=${encodeURIComponent(anoLetivoId)}&classe=${encodeURIComponent(classe)}`
            : '';
        const result = await performAction(
            `item-${itemId}`,
            () => requestApi(`/tesouraria/propinas-taxas/${encodeURIComponent(itemId)}${query}`, { method: 'DELETE' }),
            'Item removido com sucesso.'
        );
        if (result) {
            const refreshed = await loadSchoolSettings(schoolId, false);
            if (refreshed) setFeedback({ type: 'success', text: result.message || 'Item removido com sucesso.' });
        }
    };

    const saveEvaluation = async (event) => {
        event.preventDefault();
        const payload = {
            ...evaluation,
            racio_continua: Number(evaluation.racio_continua),
            racio_fixo: Number(evaluation.racio_fixo),
            ...Object.fromEntries(METRICS.map((key) => [key, String(evaluation[key] || '').trim()]))
        };
        if (payload.racio_continua + payload.racio_fixo !== 100) {
            setFeedback({ type: 'error', text: 'Os rácios da avaliação devem somar exatamente 100%.' });
            return;
        }
        await performAction('avaliacao', () => requestApi(
            `/escolas/escolas/${encodeURIComponent(schoolId)}/parametros-avaliacao`,
            { method: 'POST', body: JSON.stringify(payload) }
        ), 'Parâmetros de avaliação atualizados com sucesso.', (result) => {
            if (result.data) setEvaluation({ ...DEFAULT_EVALUATION, ...result.data });
        });
    };

    const changePassword = async (event) => {
        event.preventDefault();
        const result = await performAction('senha', () => requestApi(
            '/escolas/utilizadores/alterar-senha',
            { method: 'POST', body: JSON.stringify(passwordForm) }
        ), 'Palavra-passe alterada com sucesso.');
        if (result) setPasswordForm({ senha_atual: '', nova_senha: '' });
    };

    const changeStaffPassword = async (event) => {
        event.preventDefault();
        if (!staffPasswordForm.funcionario_id) {
            setFeedback({ type: 'error', text: 'Selecione um funcionário da escola.' });
            return;
        }
        if (staffPasswordForm.nova_senha !== staffPasswordForm.confirmar_senha) {
            setFeedback({ type: 'error', text: 'As palavras-passe não coincidem.' });
            return;
        }

        const result = await performAction('senha-funcionario', () => requestApi(
            `/direcao/funcionarios/${encodeURIComponent(staffPasswordForm.funcionario_id)}/senha`,
            { method: 'POST', body: JSON.stringify({ nova_senha: staffPasswordForm.nova_senha }) }
        ), 'Senha do funcionário alterada com sucesso.');
        if (result) setStaffPasswordForm({ funcionario_id: '', nova_senha: '', confirmar_senha: '' });
    };

    const renderActiveSectionContent = () => {
        if (loading) {
            return <div className="owner-config-loading" role="status"><span className="owner-config-spinner" />A carregar configurações institucionais…</div>;
        }
        if (!schoolId) {
            return <div className="owner-config-loading" role="alert">Nenhuma escola ativa detetada.</div>;
        }

        switch (activeSection) {
            case 'geral':
                if (!generalForm) return <div className="owner-config-loading">Sem dados gerais disponíveis.</div>;
                return (
                    <ConfigCard title="Identidade Institucional" description="Atualize o nome, sigla e informações gerais da escola.">
                        <form onSubmit={saveGeneral}>
                            <div className="configuracao-form-grid">
                                <ConfigField label="Nome da escola *">
                                    <input className="ce-input" required maxLength={150} value={generalForm.nome} onChange={(e) => updateForm(setGeneralForm, 'nome', e.target.value)} />
                                </ConfigField>
                                <ConfigField label="Sigla *">
                                    <input className="ce-input" required maxLength={20} value={generalForm.sigla} onChange={(e) => updateForm(setGeneralForm, 'sigla', e.target.value)} />
                                </ConfigField>
                                <ConfigField label="Sector institucional">
                                    <select className="ce-select" value={generalForm.sector} onChange={(e) => updateForm(setGeneralForm, 'sector', e.target.value)}>
                                        <option value="">Selecione</option>
                                        <option value="Privado">Privado</option>
                                        <option value="Público">Público</option>
                                        <option value="Comunitário / Confessional">Comunitário / Confessional</option>
                                    </select>
                                </ConfigField>
                                <ConfigField label="Região">
                                    <select className="ce-select" value={generalForm.local} onChange={(e) => updateForm(setGeneralForm, 'local', e.target.value)}>
                                        <option value="">Selecione</option>
                                        {['Bissau', 'Bafatá', 'Gabú', 'Cacheu', 'Biombo', 'Oio', 'Quinara', 'Tombali', 'Bolama / Bijagós'].map((r) => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </ConfigField>
                                <ConfigField label="Endereço">
                                    <input className="ce-input" maxLength={200} value={generalForm.endereco} onChange={(e) => updateForm(setGeneralForm, 'endereco', e.target.value)} />
                                </ConfigField>
                                <ConfigField label="Regime / turnos">
                                    <select className="ce-select" value={generalForm.regime_periodo} onChange={(e) => updateForm(setGeneralForm, 'regime_periodo', e.target.value)}>
                                        <option value="">Selecione</option>
                                        <option value="Manhã e Tarde">Manhã e Tarde</option>
                                        <option value="Regime Integral">Regime Integral</option>
                                        <option value="Pós-Laboral / Noite">Pós-Laboral / Noite</option>
                                    </select>
                                </ConfigField>
                                <ConfigField label="Cor institucional">
                                    <input className="ce-input configuracao-color-input" type="color" value={/^#[0-9a-f]{6}$/i.test(generalForm.cor_primaria) ? generalForm.cor_primaria : '#0284c7'} onChange={(e) => updateForm(setGeneralForm, 'cor_primaria', e.target.value)} />
                                </ConfigField>
                                <ConfigField label="Lema">
                                    <input className="ce-input" maxLength={180} value={generalForm.motto} onChange={(e) => updateForm(setGeneralForm, 'motto', e.target.value)} />
                                </ConfigField>
                                <ConfigField label="Visão">
                                    <textarea className="ce-input configuracao-textarea" maxLength={500} value={generalForm.visao} onChange={(e) => updateForm(setGeneralForm, 'visao', e.target.value)} />
                                </ConfigField>
                            </div>
                            <div className="configuracao-form-actions">
                                <button className="ce-btn-submit" type="submit" disabled={saving === 'geral'}>
                                    {saving === 'geral' ? 'A guardar…' : 'Guardar dados gerais'}
                                </button>
                            </div>
                        </form>
                    </ConfigCard>
                );

            case 'anos':
                return (
                    <div className="configuracao-section-stack">
                        <ConfigCard title="Calendário do Ano Letivo" description="Escolha um ano global e configure as datas do calendário escolar. Estas datas não definem quando as matrículas ficam abertas.">
                            {!globalYears.length && <p className="configuracao-empty">Não existem anos letivos globais disponíveis.</p>}
                            <form onSubmit={addSchoolYear}>
                                <div className="configuracao-form-grid">
                                    <ConfigField label="Ano letivo *">
                                        <select className="ce-select" required value={schoolYearForm.ano_letivo_id} onChange={(e) => updateForm(setSchoolYearForm, 'ano_letivo_id', e.target.value)}>
                                            <option value="">Selecione um ano</option>
                                            {globalYears.map((y) => <option key={y.id} value={y.id}>{y.ano_nome}</option>)}
                                        </select>
                                    </ConfigField>
                                    <ConfigField label="Início do ano letivo *">
                                        <input className="ce-input" type="date" required value={schoolYearForm.data_inicio} onChange={(e) => updateForm(setSchoolYearForm, 'data_inicio', e.target.value)} />
                                    </ConfigField>
                                    <ConfigField label="Fim do ano letivo *">
                                        <input className="ce-input" type="date" required min={schoolYearForm.data_inicio || undefined} value={schoolYearForm.data_fim} onChange={(e) => updateForm(setSchoolYearForm, 'data_fim', e.target.value)} />
                                    </ConfigField>
                                </div>
                                <label className="configuracao-checkbox">
                                    <input type="checkbox" checked={schoolYearForm.ativo} onChange={(e) => updateForm(setSchoolYearForm, 'ativo', e.target.checked)} /> Definir como ano letivo ativo
                                </label>
                                <div className="configuracao-form-actions">
                                    {editingSchoolYearId && <button className="configuracao-secondary-button" type="button" onClick={() => { setEditingSchoolYearId(''); setSchoolYearForm({ ano_letivo_id: '', data_inicio: '', data_fim: '', ativo: true }); }}>Cancelar</button>}
                                    <button className="ce-btn-submit" type="submit" disabled={saving === 'ano-letivo'}>{saving === 'ano-letivo' ? 'A guardar…' : editingSchoolYearId ? 'Atualizar ano' : 'Associar ano'}</button>
                                </div>
                            </form>
                        </ConfigCard>
                        <ConfigCard title="Anos letivos associados">
                            {schoolYears.length ? (
                                <ul className="configuracao-record-list">
                                    {schoolYears.map((y) => (
                                        <li key={y.id}>
                                            <div><strong>{y.ano_nome}</strong><span>{dataFormulario(y.data_inicio)} — {dataFormulario(y.data_fim)}</span></div>
                                            <div className="record-actions">
                                                <em>{y.ativo ? 'Ativo' : 'Inativo'}</em>
                                                <button className="configuracao-inline-button" type="button" onClick={() => { setEditingSchoolYearId(y.id); setSchoolYearForm({ ano_letivo_id: y.ano_letivo_id, data_inicio: dataFormulario(y.data_inicio), data_fim: dataFormulario(y.data_fim), ativo: y.ativo }); }}>Editar</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="configuracao-empty">Ainda não existem anos associados.</p>}
                        </ConfigCard>
                    </div>
                );

            case 'matriculas':
                return (
                    <div className="configuracao-section-stack">
                        <ConfigCard title="Novo Prazo de Matrícula" description="Defina o período em que a escola aceita registos e matrículas. Estas datas são independentes do calendário do ano letivo.">
                            <form onSubmit={addDeadline}>
                                <div className="configuracao-form-grid">
                                    <ConfigField label="Ano letivo *">
                                        <select className="ce-select" required value={deadlineForm.anos_letivo_id} onChange={(e) => updateForm(setDeadlineForm, 'anos_letivo_id', e.target.value)}>
                                            <option value="">Selecione um ano</option>
                                            {globalYears.map((y) => <option key={y.id} value={y.id}>{y.ano_nome}</option>)}
                                        </select>
                                    </ConfigField>
                                    <ConfigField label="Início das matrículas *">
                                        <input className="ce-input" type="date" required value={deadlineForm.data_inicio} onChange={(e) => updateForm(setDeadlineForm, 'data_inicio', e.target.value)} />
                                    </ConfigField>
                                    <ConfigField label="Fim das matrículas *">
                                        <input className="ce-input" type="date" required min={deadlineForm.data_inicio || undefined} value={deadlineForm.data_fim} onChange={(e) => updateForm(setDeadlineForm, 'data_fim', e.target.value)} />
                                    </ConfigField>
                                </div>
                                <label className="configuracao-checkbox"><input type="checkbox" checked={deadlineForm.ativo} onChange={(e) => updateForm(setDeadlineForm, 'ativo', e.target.checked)} /> Prazo ativo</label>
                                <div className="configuracao-form-actions">
                                    {editingDeadlineId && <button className="configuracao-secondary-button" type="button" onClick={() => { setEditingDeadlineId(''); setDeadlineForm({ anos_letivo_id: '', data_inicio: '', data_fim: '', ativo: true }); }}>Cancelar</button>}
                                    <button className="ce-btn-submit" type="submit" disabled={saving === 'prazo'}>{saving === 'prazo' ? 'A guardar…' : editingDeadlineId ? 'Atualizar' : 'Registar prazo'}</button>
                                </div>
                            </form>
                        </ConfigCard>
                        <ConfigCard title="Prazos Registados">
                            {enrollmentDeadlines.length ? (
                                <ul className="configuracao-record-list">
                                    {enrollmentDeadlines.map((d) => (
                                        <li key={d.id}>
                                            <div><strong>{d.ano_nome}</strong><span>{dataFormulario(d.data_inicio)} — {dataFormulario(d.data_fim)}</span></div>
                                            <div className="record-actions">
                                                <em>{d.ativo ? 'Ativo' : 'Inativo'}</em>
                                                <button className="configuracao-inline-button" type="button" onClick={() => { setEditingDeadlineId(d.id); setDeadlineForm({ anos_letivo_id: d.anos_letivo_id, data_inicio: dataFormulario(d.data_inicio), data_fim: dataFormulario(d.data_fim), ativo: d.ativo }); }}>Editar</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="configuracao-empty">Sem prazos registados.</p>}
                        </ConfigCard>
                    </div>
                );

            case 'polos':
                return (
                    <div id='polos' className="configuracao-section-stack">
                        <ConfigCard title="Adicionar Polo ou Ramo" description="Gestão de instalações e sucursais da instituição.">
                            <form onSubmit={addBranch}>
                                <div className="configuracao-form-grid">
                                    <ConfigField label="Nome do polo *"><input className="ce-input" required maxLength={120} value={branchForm.nome} onChange={(e) => updateForm(setBranchForm, 'nome', e.target.value)} /></ConfigField>
                                    <ConfigField label="Código *">
                                        <select className="ce-select" required value={branchForm.codigo} onChange={(e) => updateForm(setBranchForm, 'codigo', e.target.value)}>
                                            {availableBranchOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                        {!availableBranchOptions.length && (
                                            <small role="alert">Nenhum nível de ensino foi configurado pelo Owner.</small>
                                        )}
                                    </ConfigField>
                                    <ConfigField label="Região"><input className="ce-input" value={branchForm.local} onChange={(e) => updateForm(setBranchForm, 'local', e.target.value)} /></ConfigField>
                                    <ConfigField label="Endereço"><input className="ce-input" maxLength={200} value={branchForm.endereco} onChange={(e) => updateForm(setBranchForm, 'endereco', e.target.value)} /></ConfigField>
                                    <ConfigField label="Telefone"><GuineaBissauPhoneInput className="ce-input" maxLength={40} value={branchForm.telefone} onChange={(value) => updateForm(setBranchForm, 'telefone', value)} /></ConfigField>
                                </div>
                                <label className="configuracao-checkbox"><input type="checkbox" checked={branchForm.ativo} onChange={(e) => updateForm(setBranchForm, 'ativo', e.target.checked)} /> Polo ativo</label>
                                <div className="configuracao-form-actions">
                                    {editingBranchId && <button className="configuracao-secondary-button" type="button" onClick={() => { setEditingBranchId(''); setBranchForm({ nome: '', codigo: 'SEDE', local: 'Bissau', endereco: '', telefone: '', ativo: true }); }}>Cancelar</button>}
                                    <button className="ce-btn-submit" type="submit" disabled={saving === 'polo' || availableBranchOptions.length === 0}>{saving === 'polo' ? 'A guardar…' : editingBranchId ? 'Atualizar polo' : 'Adicionar polo'}</button>
                                </div>
                            </form>
                        </ConfigCard>
                        <ConfigCard title="Polos Registados">
                            {branches.length ? (
                                <ul className="configuracao-record-list">
                                    {branches.map((b) => (
                                        <li key={b.id}>
                                            <div><strong>{b.nome}</strong><span>{b.codigo}{b.local ? ` · ${b.local}` : ''}</span></div>
                                            <div className="record-actions">
                                                <em>{b.ativo ? 'Ativo' : 'Inativo'}</em>
                                                <button className="configuracao-inline-button" type="button" onClick={() => {
                                                    setEditingBranchId(b.id);
                                                    setBranchForm({
                                                        nome: b.nome || '',
                                                        codigo: availableBranchOptions.some((option) => option.value === b.codigo)
                                                            ? b.codigo
                                                            : availableBranchOptions[0]?.value || '',
                                                        local: b.local || '',
                                                        endereco: b.endereco || '',
                                                        telefone: b.telefone || '',
                                                        ativo: b.ativo
                                                    });
                                                }}>Editar</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="configuracao-empty">Sem polos registados.</p>}
                        </ConfigCard>
                    </div>
                );

            case 'tesouraria':
                return (
                    <div className="configuracao-section-stack">
                        <div ref={paymentFormRef}>
                        <ConfigCard title={editingPayment ? 'Editar Item de Pagamento' : 'Novo Item de Pagamento'} description={editingPayment ? 'Altere os dados e guarde as alterações neste formulário.' : 'Escolha a categoria, o ano letivo e a classe para configurar um novo item.'}>
                            <form onSubmit={addPaymentItem}>
                                <div className="configuracao-form-grid">
                                    <ConfigField label="Tipo *">
                                        <select className="ce-select" required value={paymentForm.tipo} onChange={(e) => updateForm(setPaymentForm, 'tipo', e.target.value)}>
                                            {PAYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                        </select>
                                    </ConfigField>
                                    {editingPayment && (
                                        <ConfigField label="Nome *">
                                            <input className="ce-input" required maxLength={100} value={paymentForm.nome} onChange={(e) => updateForm(setPaymentForm, 'nome', e.target.value)} />
                                        </ConfigField>
                                    )}
                                    <ConfigField label={`Ano letivo${editingPayment ? '' : ' *'}`}>
                                        <select
                                            className="ce-select"
                                            required={!editingPayment}
                                            value={paymentForm.ano_letivo_id}
                                            onChange={(e) => updateForm(setPaymentForm, 'ano_letivo_id', e.target.value)}
                                        >
                                            <option value="">Sem ano associado</option>
                                            {schoolYears.map((ano) => (
                                                <option key={ano.ano_letivo_id || ano.id} value={ano.ano_letivo_id || ano.id}>
                                                    {ano.ano_nome}{ano.ativo ? ' · Ativo' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </ConfigField>
                                    <ConfigField label={`Classe${editingPayment ? '' : ' *'}`}>
                                        <select
                                            className="ce-select"
                                            required={!editingPayment}
                                            value={paymentForm.classe}
                                            onChange={(e) => updateForm(setPaymentForm, 'classe', e.target.value)}
                                        >
                                            <option value="">Sem classe associada</option>
                                            {paymentClasses.map((classe) => <option key={classe} value={classe}>{classe}</option>)}
                                        </select>
                                    </ConfigField>
                                    <ConfigField label="Preço (CFA) *"><input className="ce-input" type="number" min={editingPayment && !paymentForm.ano_letivo_id ? '0' : '1'} step="1" required value={paymentForm.valor} onChange={(e) => updateForm(setPaymentForm, 'valor', e.target.value)} /></ConfigField>
                                    <ConfigField label="Periodicidade">
                                        <select className="ce-select" value={paymentForm.periodicidade} onChange={(e) => updateForm(setPaymentForm, 'periodicidade', e.target.value)}>
                                            <option value="unica">Única</option><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option>
                                        </select>
                                    </ConfigField>
                                    <ConfigField label="Data de vencimento"><input className="ce-input" type="date" required={Boolean(paymentForm.ano_letivo_id)} min={schoolYears.find((ano) => String(ano.ano_letivo_id || ano.id) === String(paymentForm.ano_letivo_id))?.data_inicio?.slice(0, 10)} max={schoolYears.find((ano) => String(ano.ano_letivo_id || ano.id) === String(paymentForm.ano_letivo_id))?.data_fim?.slice(0, 10)} value={paymentForm.data_vencimento} onChange={(e) => updateForm(setPaymentForm, 'data_vencimento', e.target.value)} /></ConfigField>
                                </div>
                                <label className="configuracao-checkbox"><input type="checkbox" checked={paymentForm.obrigatorio} onChange={(e) => updateForm(setPaymentForm, 'obrigatorio', e.target.checked)} /> Cobrança obrigatória</label>
                                {editingPayment && <label className="configuracao-checkbox"><input type="checkbox" checked={paymentForm.ativa} onChange={(e) => updateForm(setPaymentForm, 'ativa', e.target.checked)} /> Configuração ativa</label>}
                                <div className="configuracao-form-actions">
                                    {editingPayment && <button className="configuracao-inline-button" type="button" onClick={cancelPaymentEdit}>Cancelar</button>}
                                    <button className="ce-btn-submit" type="submit" disabled={saving === (editingPayment ? `item-${editingPayment.itemId}` : 'novo-item') || (!editingPayment && (paymentClasses.length === 0 || schoolYears.length === 0))}>
                                        {saving === (editingPayment ? `item-${editingPayment.itemId}` : 'novo-item')
                                            ? 'A guardar…'
                                            : editingPayment ? 'Guardar alterações' : 'Adicionar item'}
                                    </button>
                                </div>
                            </form>
                        </ConfigCard>
                        </div>

                        <ConfigCard
                            title="Preços por ano letivo e classe"
                            description="Os registos estão agrupados por ano letivo e classe; abra um ano para consultar os respetivos preços e regras."
                        >
                            {!pagamentosPorAno.anos.length && !pagamentosPorAno.itensSemClasse.length && (
                                <p className="configuracao-empty">Ainda não existem itens de pagamento registados.</p>
                            )}
                            <div className="configuracao-payment-years">
                                {pagamentosPorAno.anos.map((ano, index) => {
                                    const totalPerfis = ano.classes.reduce((total, [, entries]) => total + entries.length, 0);
                                    return (
                                        <details className="configuracao-payment-year" key={ano.id} open={index === 0}>
                                            <summary>
                                                <span>{ano.nome}</span>
                                                <small>{ano.classes.length} classe(s) · {totalPerfis} configuração(ões)</small>
                                            </summary>
                                            <div className="configuracao-payment-year-content">
                                                {ano.classes.map(([classe, entries]) => (
                                                    <section className="configuracao-payment-class" key={`${ano.id}:${classe}`}>
                                                        <h3>{classe}</h3>
                                                        <div className="configuracao-payment-class-items">
                                                            {entries.map(({ item, profile }) => {
                                                                const niveis = paymentLevels
                                                                    .filter((nivel) => (item.nivel_ids || []).includes(nivel.id))
                                                                    .map((nivel) => nivel.nome);
                                                                const anoNome = profile.ano_nome || ano.nome;
                                                                const categoria = PAYMENT_TYPES.find(([tipo]) => tipo === item.tipo)?.[1] || item.tipo;
                                                                return (
                                                                    <article className="configuracao-payment-row" key={`${item.id}:${ano.id}:${classe}`}>
                                                                        <div className="configuracao-payment-name">
                                                                            <strong>{item.nome}</strong>
                                                                            <span>
                                                                                {categoria} · {profile.valor} CFA · {item.periodicidade}
                                                                                {profile.data_vencimento ? ` · Vencimento ${dataFormulario(profile.data_vencimento)}` : ''}
                                                                            </span>
                                                                            <span>
                                                                                {item.obrigatorio ? 'Obrigatório' : 'Opcional'}
                                                                                {' · '}{item.ativa ? 'Ativo' : 'Inativo'}
                                                                                {' · '}{niveis.length ? `Níveis: ${niveis.join(', ')}` : 'Todos os níveis'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="configuracao-inline-actions">
                                                                            <button className="configuracao-inline-button" type="button" onClick={() => editPaymentItem(item, profile)}>
                                                                                Editar
                                                                            </button>
                                                                            <button className="configuracao-inline-button configuracao-danger-button" type="button" disabled={saving === `item-${item.id}`} onClick={() => void removePaymentItem(item.id, `${item.nome} · ${classe} · ${anoNome}`, profile.ano_letivo_id, classe)}>
                                                                                Apagar / anular
                                                                            </button>
                                                                        </div>
                                                                    </article>
                                                                );
                                                            })}
                                                        </div>
                                                    </section>
                                                ))}
                                            </div>
                                        </details>
                                    );
                                })}
                                {pagamentosPorAno.itensSemClasse.length > 0 && (
                                    <details className="configuracao-payment-year">
                                        <summary>
                                            <span>Sem ano letivo / classe</span>
                                            <small>{pagamentosPorAno.itensSemClasse.length} item(ns)</small>
                                        </summary>
                                        <div className="configuracao-payment-class-items">
                                            {pagamentosPorAno.itensSemClasse.map((item) => {
                                                const niveis = paymentLevels
                                                    .filter((nivel) => (item.nivel_ids || []).includes(nivel.id))
                                                    .map((nivel) => nivel.nome);
                                                return (
                                                    <article className="configuracao-payment-row" key={item.id}>
                                                        <div className="configuracao-payment-name">
                                                            <strong>{item.nome}</strong>
                                                            <span>
                                                                {PAYMENT_TYPES.find(([tipo]) => tipo === item.tipo)?.[1] || item.tipo}
                                                                {' · '}{item.valor} CFA · {item.periodicidade}
                                                                {' · '}{item.obrigatorio ? 'Obrigatório' : 'Opcional'}
                                                                {' · '}{item.ativa ? 'Ativo' : 'Inativo'}
                                                            </span>
                                                            <span>{niveis.length ? `Níveis: ${niveis.join(', ')}` : 'Todos os níveis'}</span>
                                                        </div>
                                                        <div className="configuracao-inline-actions">
                                                            <button className="configuracao-inline-button" type="button" onClick={() => editPaymentItem(item)}>
                                                                Editar
                                                            </button>
                                                            <button className="configuracao-inline-button configuracao-danger-button" type="button" disabled={saving === `item-${item.id}`} onClick={() => void removePaymentItem(item.id, item.nome)}>
                                                                Apagar / anular
                                                            </button>
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                    </details>
                                )}
                            </div>
                        </ConfigCard>
                    </div>
                );

            case 'avaliacao':
                return (
                    <ConfigCard title="Parâmetros de Avaliação" description="Configure os pesos e critérios das avaliações pedagógicas.">
                        <form onSubmit={saveEvaluation}>
                            <div className="configuracao-form-grid">
                                <ConfigField label="Sistema de período">
                                    <select className="ce-select" value={evaluation.sistema_periodo} onChange={(e) => setEvaluation({ ...evaluation, sistema_periodo: e.target.value })}>
                                        <option value="trimestres">Trimestres</option><option value="semestres">Semestres</option>
                                    </select>
                                </ConfigField>
                                <ConfigField label="Escala de notas">
                                    <select className="ce-select" value={evaluation.escala_nota} onChange={(e) => setEvaluation({ ...evaluation, escala_nota: e.target.value })}>
                                        <option value="0-20">0 - 20</option><option value="0-100">0 - 100</option>
                                    </select>
                                </ConfigField>
                                <ConfigField label="Rácio Avaliação Contínua (%)">
                                    <input className="ce-input" type="number" min="0" max="100" value={evaluation.racio_continua} onChange={(e) => setEvaluation({ ...evaluation, racio_continua: Number(e.target.value), racio_fixo: Math.max(0, 100 - Number(e.target.value)) })} />
                                </ConfigField>
                                <ConfigField label="Rácio Prova / Exame (%)">
                                    <input className="ce-input" type="number" min="0" max="100" value={evaluation.racio_fixo} onChange={(e) => setEvaluation({ ...evaluation, racio_fixo: Number(e.target.value), racio_continua: Math.max(0, 100 - Number(e.target.value)) })} />
                                </ConfigField>
                                {METRICS.map((key, i) => (
                                    <ConfigField key={key} label={`Critério Mético ${i + 1}`}>
                                        <input className="ce-input" maxLength={80} value={evaluation[key]} onChange={(e) => setEvaluation({ ...evaluation, [key]: e.target.value })} />
                                    </ConfigField>
                                ))}
                            </div>
                            <div className="configuracao-form-actions"><button className="ce-btn-submit" type="submit" disabled={saving === 'avaliacao'}>{saving === 'avaliacao' ? 'A guardar…' : 'Guardar parâmetros'}</button></div>
                        </form>
                    </ConfigCard>
                );

            case 'seguranca':
                return (
                    <>
                        <ConfigCard title="Segurança da Conta" description="Altere a palavra-passe de acesso institucional.">
                            <form onSubmit={changePassword}>
                                <div className="configuracao-form-grid">
                                    <ConfigField label="Palavra-passe atual *">
                                        <input className="ce-input" type="password" required value={passwordForm.senha_atual} onChange={(e) => setPasswordForm({ ...passwordForm, senha_atual: e.target.value })} />
                                    </ConfigField>
                                    <ConfigField label="Nova palavra-passe *">
                                        <input className="ce-input" type="password" required minLength={6} value={passwordForm.nova_senha} onChange={(e) => setPasswordForm({ ...passwordForm, nova_senha: e.target.value })} />
                                    </ConfigField>
                                </div>
                                <div className="configuracao-form-actions"><button className="ce-btn-submit" type="submit" disabled={saving === 'senha'}>{saving === 'senha' ? 'A alterar…' : 'Alterar palavra-passe'}</button></div>
                            </form>
                        </ConfigCard>

                        <ConfigCard
                            title="Alterar senha de funcionário"
                            description="Escolha um funcionário associado a esta escola e defina uma nova senha."
                        >
                            <form onSubmit={changeStaffPassword}>
                                <div className="configuracao-form-grid">
                                    <ConfigField label="Funcionário *">
                                        <select
                                            className="ce-input"
                                            required
                                            value={staffPasswordForm.funcionario_id}
                                            disabled={loadingStaffAccounts || staffAccounts.length === 0}
                                            onChange={(event) => setStaffPasswordForm({
                                                ...staffPasswordForm,
                                                funcionario_id: event.target.value
                                            })}
                                        >
                                            <option value="">
                                                {loadingStaffAccounts ? 'A carregar funcionários…' : 'Selecione um funcionário'}
                                            </option>
                                            {staffAccounts.map((item) => (
                                                <option key={item.funcionario_id} value={item.funcionario_id}>
                                                    {item.nome} — {item.papeis.join(', ')}{item.status_ativo ? '' : ' (conta inativa)'}
                                                </option>
                                            ))}
                                        </select>
                                    </ConfigField>
                                    <ConfigField label="Nova senha *">
                                        <input
                                            className="ce-input"
                                            type="password"
                                            required
                                            minLength={6}
                                            maxLength={128}
                                            autoComplete="new-password"
                                            value={staffPasswordForm.nova_senha}
                                            onChange={(event) => setStaffPasswordForm({
                                                ...staffPasswordForm,
                                                nova_senha: event.target.value
                                            })}
                                        />
                                    </ConfigField>
                                    <ConfigField label="Confirmar nova senha *">
                                        <input
                                            className="ce-input"
                                            type="password"
                                            required
                                            minLength={6}
                                            maxLength={128}
                                            autoComplete="new-password"
                                            value={staffPasswordForm.confirmar_senha}
                                            onChange={(event) => setStaffPasswordForm({
                                                ...staffPasswordForm,
                                                confirmar_senha: event.target.value
                                            })}
                                        />
                                    </ConfigField>
                                </div>
                                <p className="configuracao-security-note">
                                    A alteração só pode ser feita para funcionários desta escola. A senha é da conta do utilizador,
                                    por isso também será usada noutras escolas onde tenha conta. As sessões abertas serão terminadas.
                                </p>
                                <div className="configuracao-form-actions">
                                    <button
                                        className="ce-btn-submit"
                                        type="submit"
                                        disabled={saving === 'senha-funcionario' || loadingStaffAccounts || staffAccounts.length === 0}
                                    >
                                        {saving === 'senha-funcionario' ? 'A alterar…' : 'Alterar senha do funcionário'}
                                    </button>
                                </div>
                            </form>
                            {!loadingStaffAccounts && staffAccounts.length === 0 && (
                                <p role="status">Não há outros funcionários elegíveis associados a esta escola.</p>
                            )}
                        </ConfigCard>
                    </>
                );

            default:
                return null;
        }
    };

    return (
        <div className="owner-config-page">
            <header className="owner-config-header">
                <div>
                    <span className="owner-config-eyebrow">Gestão da escola</span>
                    <h1>Configurações da Direção</h1>
                    <p>{school?.nome || school?.nome_escola || 'Identidade, calendário e serviços da instituição.'}</p>
                </div>
                <div className="owner-config-header-actions">
                    <button className="owner-config-secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing || loading}>
                        <BsArrowClockwise className={refreshing ? 'owner-config-refreshing' : ''} />
                        {refreshing ? 'A atualizar…' : 'Atualizar'}
                    </button>
                    <div className="owner-config-header-account">
                        <span className="owner-config-account-avatar"><BsPersonCircle /></span>
                        <span><strong>{userInfo?.nome || 'Direção'}</strong><small>Conta da Direção</small></span>
                        <BsShieldCheck className="owner-config-account-check" aria-label="Sessão autenticada" />
                    </div>
                </div>
            </header>

            <section className="owner-config-summary" aria-label="Resumo das configurações">
                <article className="owner-config-summary-card">
                    <span className="owner-config-summary-icon is-blue"><BsCalendar3 /></span>
                    <span><small>Anos letivos associados</small><strong>{loading ? '—' : schoolYears.length}</strong></span>
                </article>
                <article className="owner-config-summary-card">
                    <span className="owner-config-summary-icon is-violet"><BsGeoAlt /></span>
                    <span><small>Polos registados</small><strong>{loading ? '—' : branches.length}</strong></span>
                </article>
                <article className="owner-config-summary-card">
                    <span className="owner-config-summary-icon is-green"><BsCashCoin /></span>
                    <span><small>Itens de pagamento</small><strong>{loading ? '—' : paymentItems.length}</strong></span>
                </article>
            </section>

            <div className="owner-config-workspace">
                <aside className="owner-config-sidebar">
                    <div className="owner-config-sidebar-heading">
                        <BsGear />
                        <div><strong>Centro de controlo</strong><small>Configurações da instituição</small></div>
                    </div>
                    <nav className="owner-config-nav" aria-label="Configurações da Direção">
                        {SECTIONS.map((section) => {
                            const Icon = section.icon;
                            const isActive = activeSection === section.id;
                            return (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => setActiveSection(section.id)}
                                    className={`owner-config-nav-item${isActive ? ' is-active' : ''}`}
                                    aria-current={isActive ? 'page' : undefined}
                                >
                                    <span className="owner-config-nav-icon"><Icon /></span>
                                    <span>
                                        <strong>{section.title}</strong>
                                        <small>{section.description}</small>
                                    </span>
                                    <span className="owner-config-nav-marker" />
                                </button>
                            );
                        })}
                    </nav>
                    <div className="owner-config-sidebar-note">
                        <BsShieldCheck />
                        <p>As alterações são guardadas na base de dados da escola e aplicadas às respetivas configurações.</p>
                    </div>
                </aside>

                <main className="owner-config-main">
                    {feedback && (
                        <div className={`owner-config-message ${feedback.type === 'success' ? 'is-success' : 'is-error'}`} role="alert">
                            {feedback.type === 'success' ? <BsCheckCircle /> : <BsExclamationTriangle />}
                            <span>{feedback.text}</span>
                            <button type="button" onClick={() => setFeedback(null)} aria-label="Fechar mensagem">×</button>
                        </div>
                    )}
                    {renderActiveSectionContent()}
                </main>
            </div>
        </div>
    );
}