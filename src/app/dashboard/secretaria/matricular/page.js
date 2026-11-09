'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useSWR from 'swr';
import { BsSearch, BsCheckCircle, BsExclamationTriangle, BsPerson, BsPeople, BsArrowRight, BsArrowLeft, BsFileEarmarkCheck, BsArrowClockwise, BsCamera, BsCheckLg, BsPencilSquare, BsToggleOn, BsToggleOff } from 'react-icons/bs';
import { GUINE_REGIOES } from '../../../../utils/constantes';
import GuineaBissauPhoneInput, { formatGuineaBissauPhone, isValidGuineaBissauPhone} from '@/components/GuineaBissauPhoneInput';
import AdminHeader from '@/components/adminHeader';
import '../../../../styles/s2.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_V1 = `${API_BASE}/api/v1`;
const API_URL_ESCOLAS = `${API_V1}/escolas`;
const API_URL_ALUNOS = `${API_V1}/alunos`;

const CHAVES_REGIOES = Object.keys(GUINE_REGIOES);

function formatarDataPeriodo(data) { return data ? String(data).slice(0, 10) : 'não definida'; }

function obterChaveRegiao(nome, local = '') {
  return CHAVES_REGIOES.find((key) => (
    GUINE_REGIOES[key].nome === nome &&
    (!local || GUINE_REGIOES[key].locales.includes(local))
  )) || CHAVES_REGIOES.find((key) => GUINE_REGIOES[key].nome === nome) || 'SAB';
}

async function fetchApiJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || !data.success) {
    const error = new Error(data.message || `Não foi possível concluir o pedido (HTTP ${response.status}).`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

const fetcherApi = (url) => fetchApiJson(url);

const FORMULARIO_REGISTO_INICIAL = {
  nome: "",
  apelido: "",
  email: "",
  telefone: "",
  genero: "Masculino",
  data_nascimento: "",
  numero_identificacao: "",
  nacionalidade: "Guineense",
  regiao_origem_key: "SAB",
  regiao_origem: GUINE_REGIOES.SAB.nome,
  local_origem: GUINE_REGIOES.SAB.locales[0] || "",
  regiao_morada_key: "SAB",
  regiao_morada: GUINE_REGIOES.SAB.nome,
  setor_morada: GUINE_REGIOES.SAB.locales[0] || "",
  endereco_morada: "",
  ultima_escola_frequentada: "",
  ultima_nota: "",
  observacoes: "",
  encarregado_nome: "",
  encarregado_apelido: "",
  encarregado_telefone: "",
  encarregado_email: "",
  parentesco: "Pai",
  encarregado_occupacao: "",
  encarregado_regiao_key: "SAB",
  encarregado_regiao_morada: GUINE_REGIOES.SAB.nome,
  encarregado_setor_morada: GUINE_REGIOES.SAB.locales[0] || "",
  encarregado_numero_identificacao: "",
  contacto_principal: true
};

export default function RegistoAluno({ escolaIdProp }) {
  const [escolaId, setEscolaId] = useState(escolaIdProp || "");
  const [modoVista, setModoVista] = useState('lista'); // 'lista', 'form-novo', 'modal-existente'
  
  const [alunos, setAlunos] = useState([]);
  const [polos, setPolos] = useState([]);
  const [poloMatriculaId, setPoloMatriculaId] = useState('');
  
  const [anoLetivoFiltro, setAnoLetivoFiltro] = useState('');
  const [poloFiltro, setPoloFiltro] = useState('');
  const [termoPesquisa, setTermoPesquisa] = useState("");
  const ultimaPesquisaLista = useRef('');
  const pedidoListaAtual = useRef(0);
  
  const [pesquisaAlunoExistente, setPesquisaAlunoExistente] = useState('');
  const [pesquisaAlunoDebounced, setPesquisaAlunoDebounced] = useState('');
  const [alunoExistenteId, setAlunoExistenteId] = useState('');
  const [turmaId, setTurmaId] = useState('');
  
  const [fotoSelecionada, setFotoSelecionada] = useState(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [etapa, setEtapa] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingAlunos, setLoadingAlunos] = useState(false);
  const [mensagem, setMensagem] = useState({ texto: "", tipo: "" });
  const [resultadoSucesso, setResultadoSucesso] = useState(null);
  const [formRegisto, setFormRegisto] = useState(FORMULARIO_REGISTO_INICIAL);
  const [contasEncarregadoEncontradas, setContasEncarregadoEncontradas] = useState(null);
  const [podeGerirRegistos, setPodeGerirRegistos] = useState(false);
  const [alunoEmEdicao, setAlunoEmEdicao] = useState(null);
  const [formEdicaoAluno, setFormEdicaoAluno] = useState({});
  const [carregandoFichaEdicao, setCarregandoFichaEdicao] = useState(false);
  const [salvandoEdicaoAluno, setSalvandoEdicaoAluno] = useState(false);
  const [alunoEmAtualizacao, setAlunoEmAtualizacao] = useState('');

  // Buscar anos letivos da escola para validação do período de matrícula e filtros
  const { data: anosResposta, error: erroAnos, isLoading: carregandoAnos } = useSWR(
    escolaId ? `${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/anos-letivos` : null,
    fetcherApi,
    { refreshInterval: 30000, revalidateOnFocus: false }
  );

  const listaAnos = useMemo(
    () => Array.isArray(anosResposta?.dados) ? anosResposta.dados : [],
    [anosResposta]
  );
  const anoAberto = listaAnos.find((ano) => ano.ativo && ano.matricula_aberta) || null;
  const anoLetivoMatriculaId = String(anoAberto?.ano_letivo_id || anoAberto?.id || '');
  const anoAtivoId = String(listaAnos.find((ano) => ano.ativo)?.ano_letivo_id || listaAnos.find((ano) => ano.ativo)?.id || '');
  const anoLetivoFiltroAtual = anoLetivoFiltro || anoAtivoId;
  const primeiroPoloAtivoId = String(polos.find((polo) => polo.ativo)?.id || '');
  const poloMatriculaIdAtual = polos.some((polo) => polo.ativo && String(polo.id) === poloMatriculaId)
    ? poloMatriculaId
    : primeiroPoloAtivoId;
  const matriculaAberta = Boolean(anoAberto);
  const podeCriarRegisto = podeGerirRegistos && !carregandoAnos && !erroAnos && matriculaAberta;
  const periodoIndisponivel = Boolean(erroAnos) || (!carregandoAnos && !matriculaAberta);

  const chavePesquisaAluno = escolaId && modoVista === 'modal-existente' && pesquisaAlunoDebounced.length >= 2 
    ? `${API_URL_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/pesquisar?termo=${encodeURIComponent(pesquisaAlunoDebounced)}` 
    : null;

  const { data: respostaPesquisa, error: erroPesquisa, isLoading: pesquisandoAluno } = useSWR(
    chavePesquisaAluno, fetcherApi, { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 400 }
  );

  const alunosEncontrados = Array.isArray(respostaPesquisa?.dados) ? respostaPesquisa.dados : [];
  const pesquisaSincronizada = pesquisaAlunoExistente.trim() === pesquisaAlunoDebounced;
  const { data: turmasResposta, error: erroTurmas, isLoading: carregandoTurmas } = useSWR(
    escolaId && anoLetivoMatriculaId && poloMatriculaIdAtual
      ? `${API_URL_ESCOLAS}/${encodeURIComponent(escolaId)}/turmas?ano_letivo_id=${encodeURIComponent(anoLetivoMatriculaId)}&polo_id=${encodeURIComponent(poloMatriculaIdAtual)}`
      : null,
    fetcherApi,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const turmasDisponiveis = Array.isArray(turmasResposta?.data) ? turmasResposta.data : [];

  const carregarAlunos = useCallback(async (idEscola, anoId = '', termo = '') => {
    const pedidoAtual = ++pedidoListaAtual.current;
    if (!idEscola || !anoId) {
      setAlunos([]);
      setLoadingAlunos(false);
      return;
    }
    try {
      setLoadingAlunos(true);
      const parametros = new URLSearchParams();
      if (anoId) parametros.set('ano_letivo_id', anoId);
      if (termo) parametros.set('search', termo);
      const queryString = parametros.toString();
      const query = queryString ? `?${queryString}` : '';
      const res = await fetchApiJson(`${API_URL_ALUNOS}/${encodeURIComponent(idEscola)}/alunos${query}`);
      if (pedidoAtual === pedidoListaAtual.current) setAlunos(res.data || []);
    } catch (err) {
      if (pedidoAtual === pedidoListaAtual.current) {
        setMensagem({ texto: err.message || "Não foi possível carregar a lista de alunos.", tipo: "erro" });
      }
    } finally {
      if (pedidoAtual === pedidoListaAtual.current) setLoadingAlunos(false);
    }
  }, []);

  const abrirEdicaoAluno = async (aluno) => {
    const alunoId = aluno.aluno_id || aluno.id;
    setCarregandoFichaEdicao(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      const resposta = await fetchApiJson(
        `${API_URL_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/${encodeURIComponent(alunoId)}/ficha`
      );
      const ficha = resposta.data;
      const dadosAluno = ficha.aluno || {};
      const utilizador = ficha.utilizador || {};
      setAlunoEmEdicao(aluno);
      setFormEdicaoAluno({
        nome: utilizador.nome || '',
        apelido: dadosAluno.apelido || '',
        telefone: utilizador.telefone || '',
        email: utilizador.email || '',
        genero: dadosAluno.genero || 'Masculino',
        data_nascimento: dadosAluno.data_nascimento ? String(dadosAluno.data_nascimento).slice(0, 10) : '',
        numero_identificacao: dadosAluno.numero_identificacao || '',
        nacionalidade: dadosAluno.nacionalidade || '',
        regiao_origem: dadosAluno.regiao_origem || '',
        local_origem: dadosAluno.local_origem || '',
        regiao_morada: dadosAluno.regiao_morada || '',
        setor_morada: dadosAluno.setor_morada || '',
        endereco_morada: dadosAluno.endereco_morada || '',
        ultima_escola_frequentada: dadosAluno.ultima_escola_frequentada || ''
      });
    } catch (error) {
      setMensagem({ texto: error.message || 'Não foi possível carregar a ficha do aluno.', tipo: 'erro' });
    } finally {
      setCarregandoFichaEdicao(false);
    }
  };

  const guardarEdicaoAluno = async (event) => {
    event.preventDefault();
    const alunoId = alunoEmEdicao?.aluno_id || alunoEmEdicao?.id;
    if (!alunoId) return;
    setSalvandoEdicaoAluno(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      const body = new FormData();
      Object.entries(formEdicaoAluno).forEach(([campo, valor]) => {
        const valorFinal = campo === 'telefone' && valor
          ? formatGuineaBissauPhone(valor)
          : valor;
        body.append(campo, String(valorFinal ?? ''));
      });
      await fetchApiJson(`${API_URL_ALUNOS}/${encodeURIComponent(alunoId)}`, {
        method: 'PUT',
        body
      });
      setAlunoEmEdicao(null);
      setMensagem({ texto: 'Dados do aluno atualizados com sucesso.', tipo: 'sucesso' });
      await carregarAlunos(escolaId, anoLetivoFiltroAtual, termoPesquisa.trim());
    } catch (error) {
      setMensagem({ texto: error.message || 'Não foi possível atualizar os dados do aluno.', tipo: 'erro' });
    } finally {
      setSalvandoEdicaoAluno(false);
    }
  };

  const alternarEstadoAluno = async (aluno) => {
    const alunoId = aluno.aluno_id || aluno.id;
    const novoEstado = !aluno.status_ativo;
    const acao = novoEstado ? 'ativar' : 'desativar';
    if (!window.confirm(`Deseja ${acao} a conta de ${aluno.nome} ${aluno.apelido || ''}? Os dados e o histórico escolar serão preservados.`)) return;
    setAlunoEmAtualizacao(alunoId);
    setMensagem({ texto: '', tipo: '' });
    try {
      const resposta = await fetchApiJson(`${API_URL_ALUNOS}/${encodeURIComponent(alunoId)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_ativo: novoEstado })
      });
      setMensagem({ texto: resposta.message || `Conta do aluno ${novoEstado ? 'ativada' : 'desativada'}.`, tipo: 'sucesso' });
      await carregarAlunos(escolaId, anoLetivoFiltroAtual, termoPesquisa.trim());
    } catch (error) {
      setMensagem({ texto: error.message || 'Não foi possível alterar o estado da conta.', tipo: 'erro' });
    } finally {
      setAlunoEmAtualizacao('');
    }
  };

  const prepararNovoAluno = () => {
    setAlunoExistenteId('');
    setPoloMatriculaId(String(
      polos.some((polo) => polo.ativo && String(polo.id) === poloFiltro)
        ? poloFiltro
        : primeiroPoloAtivoId
    ));
    setTurmaId('');
    setEtapa(1);
    setResultadoSucesso(null);
    setFormRegisto(FORMULARIO_REGISTO_INICIAL);
    setContasEncarregadoEncontradas(null);
    setFotoPreview('');
    setFotoSelecionada(null);
    setModoVista('form-novo');
  };

  const selecionarAlunoExistente = async (alunoSelecionado) => {
    setLoading(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      const resposta = await fetchApiJson(
        `${API_URL_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/${encodeURIComponent(alunoSelecionado.aluno_id)}/ficha?ano_letivo_id=${encodeURIComponent(anoLetivoMatriculaId)}`
      );
      const ficha = resposta.data;
      const aluno = ficha.aluno || {};
      const utilizador = ficha.utilizador || {};
      const encarregado = (ficha.encarregados || []).find((item) => item.contacto_principal) || ficha.encarregados?.[0] || {};
      const utilizadorEncarregado = encarregado.utilizador || {};
      const apelidoEncarregado = encarregado.apelido || '';
      const nomeEncarregadoCompleto = utilizadorEncarregado.nome || '';
      const terminaComApelido = apelidoEncarregado
        && nomeEncarregadoCompleto.toLocaleLowerCase().endsWith(` ${apelidoEncarregado.toLocaleLowerCase()}`);
      const nomeEncarregado = terminaComApelido
        ? nomeEncarregadoCompleto.slice(0, -apelidoEncarregado.length).trim()
        : nomeEncarregadoCompleto;
      const regiaoOrigemKey = obterChaveRegiao(aluno.regiao_origem, aluno.local_origem);
      const regiaoMoradaKey = obterChaveRegiao(aluno.regiao_morada, aluno.setor_morada);
      const regiaoEncarregadoKey = obterChaveRegiao(encarregado.regiao_morada, encarregado.setor_morada);

      setAlunoExistenteId(alunoSelecionado.aluno_id);
      setFormRegisto({
        ...FORMULARIO_REGISTO_INICIAL,
        nome: utilizador.nome || aluno.nome || '',
        apelido: aluno.apelido || '',
        email: utilizador.email || '',
        telefone: utilizador.telefone || '',
        genero: ['Masculino', 'Feminino'].includes(aluno.genero) ? aluno.genero : 'Masculino',
        data_nascimento: aluno.data_nascimento ? String(aluno.data_nascimento).slice(0, 10) : '',
        numero_identificacao: aluno.numero_identificacao || '',
        nacionalidade: aluno.nacionalidade || 'Guineense',
        regiao_origem_key: regiaoOrigemKey,
        regiao_origem: aluno.regiao_origem || GUINE_REGIOES[regiaoOrigemKey].nome,
        local_origem: aluno.local_origem || GUINE_REGIOES[regiaoOrigemKey].locales[0] || '',
        regiao_morada_key: regiaoMoradaKey,
        regiao_morada: aluno.regiao_morada || GUINE_REGIOES[regiaoMoradaKey].nome,
        setor_morada: aluno.setor_morada || GUINE_REGIOES[regiaoMoradaKey].locales[0] || '',
        endereco_morada: aluno.endereco_morada || '',
        ultima_escola_frequentada: aluno.ultima_escola_frequentada || '',
        ultima_nota: aluno.ultima_nota ?? '',
        observacoes: aluno.observacoes || '',
        encarregado_nome: nomeEncarregado,
        encarregado_apelido: apelidoEncarregado,
        encarregado_telefone: utilizadorEncarregado.telefone || '',
        encarregado_email: utilizadorEncarregado.email || '',
        parentesco: encarregado.parentesco || 'Pai',
        encarregado_occupacao: encarregado.occupacao || '',
        encarregado_regiao_key: regiaoEncarregadoKey,
        encarregado_regiao_morada: encarregado.regiao_morada || GUINE_REGIOES[regiaoEncarregadoKey].nome,
        encarregado_setor_morada: encarregado.setor_morada || GUINE_REGIOES[regiaoEncarregadoKey].locales[0] || '',
        encarregado_numero_identificacao: encarregado.numero_identificacao || '',
        contacto_principal: true
      });
      setFotoSelecionada(null);
      setFotoPreview('');
      setEtapa(1);
      setResultadoSucesso(null);
      setModoVista('form-novo');
    } catch (error) {
      setMensagem({ texto: error.message || 'Não foi possível carregar a ficha do aluno.', tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const carregarDadosIniciais = async () => {
      try {
        setLoading(true);
        const sessaoRes = await fetchApiJson(`${API_V1}/auth/me`, { signal: controller.signal });
        const dadosSessao = sessaoRes.data;
        const papel = String(dadosSessao?.conta_ativa?.papel_norm || dadosSessao?.conta_ativa?.papel || '')
          .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        setPodeGerirRegistos(dadosSessao?.tipo === 'owner' || [
          'direcao',
          'secretaria',
          'secretario',
          'secretaria escolar',
          'secretario escolar',
          'admin',
          'administrador'
        ].includes(papel));
        let escolaIdAtual = escolaIdProp || dadosSessao?.conta_ativa?.escola_id;
        if (!escolaIdAtual) throw new Error("Não foi encontrada uma escola ativa.");
        setEscolaId(escolaIdAtual);

        const polosRes = await fetchApiJson(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaIdAtual)}/polos`, { signal: controller.signal });
        setPolos(polosRes.data || []);
      } catch (err) {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setMensagem({ texto: err.message || "Erro ao carregar dados.", tipo: "erro" });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    carregarDadosIniciais();
    return () => controller.abort();
  }, [escolaIdProp, carregarAlunos]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPesquisaAlunoDebounced(pesquisaAlunoExistente.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [pesquisaAlunoExistente]);

  useEffect(() => {
    if (!escolaId || carregandoAnos || erroAnos) return;
    if (!anoLetivoFiltroAtual) {
      pedidoListaAtual.current += 1;
      ultimaPesquisaLista.current = '';
      return;
    }

    const timer = window.setTimeout(() => {
      const termo = termoPesquisa.trim();
      const chavePesquisa = `${escolaId}:${anoLetivoFiltroAtual}:${termo}`;
      if (chavePesquisa === ultimaPesquisaLista.current) return;
      ultimaPesquisaLista.current = chavePesquisa;
      void carregarAlunos(escolaId, anoLetivoFiltroAtual, termo);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [termoPesquisa, escolaId, anoLetivoFiltroAtual, carregandoAnos, erroAnos, carregarAlunos]);

  const handleSubmeterRegisto = async (e, contaConfirmada = null) => {
    e?.preventDefault();
    let dadosRegisto = formRegisto;
    if (contaConfirmada) {
      const nomeConta = String(contaConfirmada.nome || '').trim();
      const apelidoConta = String(contaConfirmada.apelido || '').trim();
      const nomeSemApelido = apelidoConta && nomeConta.toLocaleLowerCase().endsWith(` ${apelidoConta.toLocaleLowerCase()}`)
        ? nomeConta.slice(0, -(apelidoConta.length + 1)).trim()
        : nomeConta;
      dadosRegisto = {
        ...formRegisto,
        encarregado_nome: nomeSemApelido || nomeConta || formRegisto.encarregado_nome,
        encarregado_apelido: apelidoConta || formRegisto.encarregado_apelido,
        encarregado_telefone: contaConfirmada.telefone || formRegisto.encarregado_telefone,
        encarregado_email: contaConfirmada.email || formRegisto.encarregado_email
      };
      setFormRegisto(dadosRegisto);
      setContasEncarregadoEncontradas(null);
    }
    if (!podeGerirRegistos) {
      setMensagem({ texto: "Apenas a Secretaria ou a Direção pode registar alunos.", tipo: "erro" });
      return;
    }
    if (erroAnos) {
      setMensagem({ texto: `Não foi possível verificar o período de matrícula: ${erroAnos.message}`, tipo: "erro" });
      return;
    }
    if (carregandoAnos) {
      setMensagem({ texto: "Aguarde a verificação do período de matrícula.", tipo: "erro" });
      return;
    }
    if (!matriculaAberta) {
      setMensagem({ texto: "Matrícula fechada — o período de registo/matrícula não está em curso.", tipo: "erro" });
      return;
    }
    if (!escolaId) {
      setMensagem({ texto: "Escola não identificada.", tipo: "erro" });
      return;
    }
    if (!anoLetivoMatriculaId || !poloMatriculaIdAtual) {
      setMensagem({ texto: "Selecione um ramo para a matrícula do ano letivo ativo.", tipo: "erro" });
      return;
    }
    if (!turmaId) {
      setMensagem({ texto: "Selecione a turma para este ano letivo.", tipo: "erro" });
      setEtapa(3);
      return;
    }
    const camposEmFalta = [];
    if (!String(dadosRegisto.nome || '').trim()) camposEmFalta.push('nome do aluno');
    if (!isValidGuineaBissauPhone(dadosRegisto.telefone)) camposEmFalta.push('telemóvel do aluno (mínimo 7 dígitos)');
    const emailAluno = String(dadosRegisto.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAluno)) {
      camposEmFalta.push('email válido e exclusivo do aluno');
    }
    if (!String(dadosRegisto.encarregado_nome || '').trim()) camposEmFalta.push('nome do encarregado');
    if (!isValidGuineaBissauPhone(dadosRegisto.encarregado_telefone)) camposEmFalta.push('telemóvel do encarregado (mínimo 7 dígitos)');
    const emailEncarregado = String(dadosRegisto.encarregado_email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEncarregado)) {
      camposEmFalta.push('email válido do encarregado (obrigatório para acesso à conta)');
    }
    if (camposEmFalta.length) {
      setMensagem({ texto: `Verifique os campos: ${camposEmFalta.join(', ')}.`, tipo: "erro" });
      return;
    }

    setLoading(true);
    setMensagem({ texto: "", tipo: "" });
    try {
      const body = new FormData();
      Object.entries(dadosRegisto).forEach(([campo, valor]) => {
        if (valor !== undefined && valor !== null) {
          const valorFinal = campo === 'telefone' || campo === 'encarregado_telefone'
            ? formatGuineaBissauPhone(valor)
            : valor;
          body.append(campo, String(valorFinal));
        }
      });
      body.append('ano_letivo_id', anoLetivoMatriculaId);
      body.append('polo_id', poloMatriculaIdAtual);
      body.append('turma_id', turmaId);
      if (contaConfirmada) body.append('encarregado_conta_confirmada_id', contaConfirmada.id);
      if (alunoExistenteId) body.append('aluno_id', alunoExistenteId);
      if (fotoSelecionada) body.append('foto', fotoSelecionada);

      const data = await fetchApiJson(`${API_URL_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/matricular`, { method: 'POST', body });
      setResultadoSucesso(data.data);
      setMensagem({ texto: data.message || "Matrícula enviada à Direção para decisão.", tipo: "sucesso" });
      void carregarAlunos(escolaId, anoLetivoMatriculaId, termoPesquisa.trim());
    } catch (err) {
      if (err.data?.confirmationRequired && Array.isArray(err.data.accounts)) {
        setContasEncarregadoEncontradas(err.data.accounts);
        setMensagem({ texto: "", tipo: "" });
      } else {
        setMensagem({ texto: err.message || "Erro de ligação com o servidor ao guardar registo.", tipo: "erro" });
      }
    } finally {
      setLoading(false);
    }
  };

  const alunosFiltrados = alunos.filter((aluno) => {
    const termoNormalizado = termoPesquisa.trim().toLocaleLowerCase();
    const correspondePesquisa = [
      aluno.nome,
      aluno.apelido,
      aluno.login_id,
      aluno.telefone,
      aluno.email,
      aluno.encarregado_nome,
      aluno.encarregado_apelido,
      aluno.encarregado_email,
      aluno.encarregado_telefone
    ].some((valor) => String(valor || '').toLocaleLowerCase().includes(termoNormalizado));
    const correspondePolo = poloFiltro ? aluno.polo_id === poloFiltro : true;
    return correspondePesquisa && correspondePolo;
  });

  return (
    <div className="sec-matricular-page">
      <AdminHeader titulo="Registo Pessoal de Alunos" descricao="Registe novos alunos e associe-os ao ano letivo, ramo e turma; os pagamentos são lançados separadamente."/>
      {modoVista !== 'lista' && (
            <button onClick={() => setModoVista('lista')} className="matricula-style-001">
              <BsArrowLeft /> Voltar à Lista
            </button>
          )}
      <div role="status" className={["matricula-style-002",(periodoIndisponivel?"matricula-style-002-border-1":"matricula-style-002-border-2"),(periodoIndisponivel?"matricula-style-002-background-1":"matricula-style-002-background-2"),(periodoIndisponivel?"matricula-style-002-color-1":"matricula-style-002-color-2")].filter(Boolean).join(' ')}>
          {erroAnos ? <BsExclamationTriangle /> : matriculaAberta ? <BsCheckCircle /> : <BsExclamationTriangle />}
          <span>
            {erroAnos
              ? `Não foi possível verificar o período de matrícula: ${erroAnos.message}`
              : carregandoAnos
                ? 'A verificar o período de matrícula...'
                : matriculaAberta
                ? `Prazo de Matrícula Aberto — Ano Letivo ${anoAberto.ano_nome} (${formatarDataPeriodo(anoAberto.matricula_data_inicio)} a ${formatarDataPeriodo(anoAberto.matricula_data_fim)})`
                  : 'Matrícula Fechada — Não há prazo de matrícula ativo para a data atual.'}
          </span>
        </div>

        {!podeGerirRegistos && !loading && (
          <div role="status" className="matricula-style-003">
            O seu perfil pode consultar os alunos, mas apenas a Secretaria ou a Direção pode registar ou matricular.
          </div>
        )}

      {mensagem.texto && (
        <div className={["matricula-style-004",(mensagem.tipo==='sucesso'?"matricula-style-004-background-1":"matricula-style-004-background-2"),(mensagem.tipo==='sucesso'?"matricula-style-004-color-1":"matricula-style-004-color-2")].filter(Boolean).join(' ')}>
          {mensagem.tipo === 'sucesso' ? <BsCheckCircle /> : <BsExclamationTriangle />} <span>{mensagem.texto}</span>
        </div>
      )}

      {/* VISTA 1: LISTA GERAL COM FILTROS (1. Ano Letivo, 2. Polo, 3. Pesquisa) */}
      {modoVista === 'lista' && (
        <div>
          <section className="matricula-style-005">
            <h2 className="matricula-style-006">Iniciar matrícula</h2>
            <p className="matricula-style-007">
              Os pagamentos são registados separadamente na conta financeira do aluno, na página de Propinas.
            </p>
            {podeCriarRegisto && (
              <div className="matricula-style-022">
                <button type="button" onClick={prepararNovoAluno} className="matricula-style-023">
                  <BsPeople className="matricula-style-024" /> Novo aluno
                </button>
                <button
                  type="button"
                  onClick={() => { setModoVista('modal-existente'); setPesquisaAlunoExistente(''); }}
                  className="matricula-style-025"
                >
                  <BsPerson className="matricula-style-024" /> Aluno existente
                </button>
              </div>
            )}
          </section>

          <div className="matricula-style-026">
            
            {/* 1. Filtro por Ano Letivo */}
            <div>
              <select 
                value={anoLetivoFiltroAtual}
                onChange={(e) => setAnoLetivoFiltro(e.target.value)} 
                className="ce-select matricula-style-027" 
                
              >
                <option value="">{carregandoAnos ? 'A carregar anos letivos...' : 'Selecione um ano letivo'}</option>
                {listaAnos.map(a => <option key={a.ano_letivo_id || a.id} value={a.ano_letivo_id || a.id}>{a.ano_nome} · Ano letivo: {formatarDataPeriodo(a.data_inicio)} — {formatarDataPeriodo(a.data_fim)} {a.ativo ? '(Ativo)' : ''}</option>)}
              </select>
            </div>

            {/* 2. Filtro por Polo */}
            <div>
              <select 
                value={poloFiltro} 
                onChange={(e) => setPoloFiltro(e.target.value)} 
                className="ce-select matricula-style-027" 
                
              >
                <option value="">Todos os Polos</option>
                {polos.filter((polo) => polo.ativo).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>

            {/* 3. Pesquisa Textual */}
            <div className="matricula-style-028">
              <BsSearch color="#64748b" className="matricula-style-029" />
              <input 
                type="text" 
                placeholder="3. Pesquisar por nome, ID ou telemóvel..." 
                value={termoPesquisa} 
                onChange={(e) => setTermoPesquisa(e.target.value)} 
                className="matricula-style-030" 
              />
            </div>

            <button onClick={() => carregarAlunos(escolaId, anoLetivoFiltroAtual, termoPesquisa.trim())} disabled={!anoLetivoFiltroAtual} title="Atualizar Lista" className={["matricula-style-031",(anoLetivoFiltroAtual?"matricula-style-031-cursor-1":"matricula-style-031-cursor-2")].filter(Boolean).join(' ')}>
              <BsArrowClockwise size={16} color="#334155" />
            </button>
          </div>

          <div className="matricula-style-032">
            {!anoLetivoFiltroAtual ? (
              <p className="matricula-style-033">Selecione um ano letivo para carregar as matrículas.</p>
            ) : loadingAlunos ? (
              <p className="matricula-style-034">A carregar alunos registados...</p>
            ) : alunosFiltrados.length > 0 ? (
              <table className="matricula-style-035">
                <thead>
                  <tr className="matricula-style-036">
                    <th className="matricula-style-037">Nome Completo</th>
                    <th className="matricula-style-037">ID de Acesso</th>
                    <th className="matricula-style-037">Telemóvel</th>
                    <th className="matricula-style-037">Encarregado</th>
                    <th className="matricula-style-037">Estado</th>
                    {podeGerirRegistos && <th className="matricula-style-037">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {alunosFiltrados.map((al) => (
                    <tr key={al.aluno_id || al.id} className="matricula-style-038">
                      <td className="matricula-style-039">{al.nome} {al.apelido}</td>
                      <td className="matricula-style-037"><code className="matricula-style-040">{al.login_id}</code></td>
                      <td className="matricula-style-037">{al.telefone || 'Sem telemóvel'}</td>
                      <td className="matricula-style-041">{al.encarregado_nome ? `${al.encarregado_nome} ${al.encarregado_apelido || ''}` : 'Não associado'}</td>
                      <td className={["matricula-style-042",(al.status_ativo?"matricula-style-042-color-1":"matricula-style-042-color-2")].filter(Boolean).join(' ')}>
                        {al.status_ativo ? 'Ativo' : 'Inativo'}
                      </td>
                      {podeGerirRegistos && (
                        <td className="matricula-style-043">
                          <button
                            type="button"
                            onClick={() => abrirEdicaoAluno(al)}
                            disabled={carregandoFichaEdicao || Boolean(alunoEmAtualizacao)}
                            title="Editar informações do aluno"
                            className="matricula-style-044"
                          >
                            <BsPencilSquare /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => alternarEstadoAluno(al)}
                            disabled={Boolean(alunoEmAtualizacao)}
                            title={al.status_ativo ? 'Desativar conta sem apagar o histórico' : 'Ativar conta'}
                            className={["matricula-style-045",(al.status_ativo?"matricula-style-045-border-1":"matricula-style-045-border-2"),(al.status_ativo?"matricula-style-045-background-1":"matricula-style-045-background-2"),(al.status_ativo?"matricula-style-045-color-1":"matricula-style-045-color-2")].filter(Boolean).join(' ')}
                          >
                            {al.status_ativo ? <><BsToggleOff /> Desativar</> : <><BsToggleOn /> Ativar</>}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="matricula-style-046">
                <p className="matricula-style-047">Nenhum aluno registado encontrado com estes filtros.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {modoVista === 'lista' && alunoEmEdicao && (
        <div role="dialog" aria-modal="true" aria-labelledby="editar-aluno-titulo" className="matricula-style-048">
          <form onSubmit={guardarEdicaoAluno} className="matricula-style-049">
            <h2 id="editar-aluno-titulo" className="matricula-style-050">Editar informações do aluno</h2>
            <p className="matricula-style-051">{alunoEmEdicao.nome} · ID {alunoEmEdicao.login_id}</p>
            {carregandoFichaEdicao ? (
              <p role="status" className="matricula-style-052">A carregar ficha do aluno...</p>
            ) : (
              <div className="matricula-style-053">
                {[
                  ['nome', 'Nome', 'text', true],
                  ['apelido', 'Apelido', 'text', true],
                  ['telefone', 'Telemóvel', 'tel', false],
                  ['email', 'Email', 'email', false],
                  ['genero', 'Género', 'select', false],
                  ['data_nascimento', 'Data de nascimento', 'date', false],
                  ['numero_identificacao', 'Nº de identificação', 'text', false],
                  ['nacionalidade', 'Nacionalidade', 'text', false],
                  ['regiao_origem', 'Região de origem', 'text', false],
                  ['local_origem', 'Local de origem', 'text', false],
                  ['regiao_morada', 'Região de morada', 'text', false],
                  ['setor_morada', 'Sector / Bairro', 'text', false],
                  ['endereco_morada', 'Endereço', 'text', false],
                  ['ultima_escola_frequentada', 'Última escola frequentada', 'text', false]
                ].map(([campo, rotulo, tipo, obrigatorio]) => (
                  <label key={campo} className="matricula-style-054">
                    {rotulo}
                    {tipo === 'select' ? (
                      <select
                        value={formEdicaoAluno[campo] || 'Masculino'}
                        onChange={(event) => setFormEdicaoAluno((atual) => ({ ...atual, [campo]: event.target.value }))}
                        className="matricula-style-055"
                      >
                        {['Masculino', 'Feminino', 'Outro'].map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
                      </select>
                    ) : (
                      <input
                        type={tipo}
                        value={formEdicaoAluno[campo] || ''}
                        required={obrigatorio}
                        onChange={(event) => setFormEdicaoAluno((atual) => ({ ...atual, [campo]: event.target.value }))}
                        className="matricula-style-056"
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
            <div className="matricula-style-057">
              <button type="button" onClick={() => setAlunoEmEdicao(null)} disabled={salvandoEdicaoAluno} className="matricula-style-058">Cancelar</button>
              <button type="submit" disabled={carregandoFichaEdicao || salvandoEdicaoAluno} className={["matricula-style-059",(salvandoEdicaoAluno?"matricula-style-059-cursor-1":"matricula-style-059-cursor-2")].filter(Boolean).join(' ')}>
                {salvandoEdicaoAluno ? 'A guardar...' : 'Guardar alterações'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL / VISTA 2: PESQUISA DE ALUNO EXISTENTE */}
      {modoVista === 'modal-existente' && (
        <div className="matricula-style-060">
          <h3 className="matricula-style-061">
            <BsPerson /> Localizar Aluno Existente
          </h3>
          <p className="matricula-style-051">
            Pesquise o aluno existente para carregar a ficha no formulário de matrícula. Os dados podem ser atualizados antes do envio à Direção.
          </p>
          
          <div className="matricula-style-062">
            <BsSearch color="#64748b" />
            <input type="search" value={pesquisaAlunoExistente} onChange={(e) => setPesquisaAlunoExistente(e.target.value)} placeholder="Pesquisar por nome, ID ou telemóvel..." className="matricula-style-063" />
          </div>

          {pesquisandoAluno && <p className="matricula-style-064">A pesquisar aluno...</p>}
          {erroPesquisa && <p className="matricula-style-065">{erroPesquisa.message}</p>}

          {pesquisaSincronizada && alunosEncontrados.length > 0 && (
            <div className="matricula-style-066">
              {alunosEncontrados.map((aluno) => (
                <div key={aluno.aluno_id} className="matricula-style-067">
                  <div>
                    <strong className="matricula-style-068">{aluno.nome} {aluno.apelido}</strong>
                    <span className="matricula-style-069">
                      ID: <code className="matricula-style-070">{aluno.login_id}</code>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => selecionarAlunoExistente(aluno)}
                    disabled={loading}
                    className={["matricula-style-071",(loading?"matricula-style-071-cursor-1":"matricula-style-071-cursor-2")].filter(Boolean).join(' ')}
                  >
                    Usar ficha
                  </button>
                </div>
              ))}
            </div>
          )}

          {pesquisaSincronizada && pesquisaAlunoDebounced.length >= 2 && !pesquisandoAluno && alunosEncontrados.length === 0 && (
            <p className="matricula-style-072">Nenhum aluno localizado com este termo.</p>
          )}

          <div className="matricula-style-073">
            <button onClick={() => setModoVista('lista')} className="matricula-style-074">
              Fechar / Voltar
            </button>
          </div>
        </div>
      )}

      {/* VISTA 3: FORMULÁRIO EM 3 ETAPAS PARA NOVO INGRESSO (COM FOTOGRAFIA DE ESPAÇO FIXO 150x200) */}
      {modoVista === 'form-novo' && (
        <div className="matricula-style-075">
          {resultadoSucesso ? (
            <div className="matricula-style-076">
              <BsFileEarmarkCheck size={48} color="#16a34a" className="matricula-style-077" />
              <h2 className="matricula-style-078">Registo Pessoal Concluído com Sucesso!</h2>
              <div className="matricula-style-079">
                <p className="matricula-style-080">Matrícula: <code className="matricula-style-081">{resultadoSucesso.numero_matricula}</code></p>
                <p className="matricula-style-080">Ano letivo: <strong>{anoAberto?.ano_nome || '—'}</strong></p>
                <p className="matricula-style-080">Estado: <strong>pendente de decisão da Direção</strong></p>
                {resultadoSucesso.login_id && <p className="matricula-style-080">🔑 <strong>ID do Aluno:</strong> <code className="matricula-style-081">{resultadoSucesso.login_id}</code></p>}
                {resultadoSucesso.senha_temporaria && <p className="matricula-style-080">🔒 <strong>Senha Inicial:</strong> <code className="matricula-style-082">{resultadoSucesso.senha_temporaria}</code></p>}
              </div>
              <div className="matricula-style-083">
                <button onClick={() => setModoVista('lista')} className="matricula-style-084">
                  Concluir
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmeterRegisto}>
              
              {/* NAVEGAÇÃO DE ETAPAS */}
              <div className="matricula-style-085">
                <div className={["matricula-style-086",(etapa===1?"matricula-style-086-color-1":"matricula-style-086-color-2")].filter(Boolean).join(' ')}>1. Informações do Aluno</div>
                <div className={["matricula-style-087",(etapa===2?"matricula-style-087-color-1":"matricula-style-087-color-2")].filter(Boolean).join(' ')}>2. Encarregado de Educação</div>
                <div className={["matricula-style-088",(etapa===3?"matricula-style-088-color-1":"matricula-style-088-color-2")].filter(Boolean).join(' ')}>3. Confirmação & Gravação</div>
              </div>

              {/* ETAPA 1: ALUNO (COM FOTOGRAFIA FIXA 150x200 E CAMPOS PROFISSIONAIS) */}
              {etapa === 1 && (
                <div>
                  <h3 className="matricula-style-089">
                    <BsPerson /> Passo 1: Informações Pessoais, Origem e Histórico
                  </h3>
                  
                  {/* LAYOUT PROFISSIONAL COM ESPAÇO FIXO PARA A FOTO E RESTO FLEXÍVEL */}
                  <div className="matricula-style-090">
                    
                    {/* Bloco da Foto (Espaço Fixo Profissional 150x200) */}
                    <div>
                      <label className="matricula-style-091"><BsCamera /> Fotografia (opcional)</label>
                      
                      {!fotoPreview ? (
                        <div className="matricula-style-092">
                          <input 
                            type="file" 
                            accept="image/jpeg,image/png,image/webp" 
                            onChange={(e) => { 
                              const ficheiro = e.target.files?.[0] || null; 
                              setFotoSelecionada(ficheiro); 
                              setFotoPreview(ficheiro ? URL.createObjectURL(ficheiro) : ''); 
                            }} 
                            className="matricula-style-093" 
                          />
                          <BsCamera size={32} color="#94a3b8" className="matricula-style-094" />
                          <span className="matricula-style-095">Carregar Foto (150x200)</span>
                        </div>
                      ) : (
                        <div className="matricula-style-096">
                          <img 
                            src={fotoPreview} 
                            alt="Pré-visualização da fotografia" 
                            className="matricula-style-097" 
                          />
                          <button 
                            type="button" 
                            onClick={() => { setFotoPreview(''); setFotoSelecionada(null); }}
                            className="matricula-style-098"
                          >
                            Alterar Foto
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Campos restantes a preencher o espaço restante */}
                    <div className="matricula-style-099">
                      <div>
                        <label className="matricula-style-091">Nome *</label>
                        <input type="text" required value={formRegisto.nome} onChange={e => setFormRegisto({...formRegisto, nome: e.target.value})} className="ce-input matricula-style-100"  placeholder="Ex: Amadu" />
                      </div>
                      <div>
                        <label className="matricula-style-091">Apelido</label>
                        <input type="text" value={formRegisto.apelido} onChange={e => setFormRegisto({...formRegisto, apelido: e.target.value})} className="ce-input matricula-style-100"  placeholder="Ex: Baldé" />
                      </div>
                      <div>
                        <label className="matricula-style-091">Telemóvel (Senha) *</label>
                        <GuineaBissauPhoneInput required value={formRegisto.telefone} onChange={value => setFormRegisto(current => ({ ...current, telefone: value }))} className="ce-input matricula-style-100"  placeholder="+245 95XXXXXXX" />
                      </div>
                      <div>
                        <label className="matricula-style-091">Email do aluno (único) *</label>
                        <input type="email" required value={formRegisto.email} onChange={e => setFormRegisto({...formRegisto, email: e.target.value})} className="ce-input matricula-style-100"  placeholder="aluno@email.com" />
                      </div>
                      <div>
                        <label className="matricula-style-091">Género *</label>
                        <select value={formRegisto.genero} onChange={e => setFormRegisto({...formRegisto, genero: e.target.value})} className="ce-select matricula-style-100" >
                          <option value="Masculino">Masculino</option>
                          <option value="Feminino">Feminino</option>
                        </select>
                      </div>
                      <div>
                        <label className="matricula-style-091">Data de Nascimento</label>
                        <input type="date" value={formRegisto.data_nascimento} onChange={e => setFormRegisto({...formRegisto, data_nascimento: e.target.value})} className="ce-input matricula-style-100"  />
                      </div>
                      <div>
                        <label className="matricula-style-091">Nacionalidade</label>
                        <input type="text" value={formRegisto.nacionalidade} onChange={e => setFormRegisto({...formRegisto, nacionalidade: e.target.value})} className="ce-input matricula-style-100"  />
                      </div>
                      <div className="matricula-style-101">
                        <label className="matricula-style-091">Nº Identificação (BI / Cédula)</label>
                        <input type="text" value={formRegisto.numero_identificacao} onChange={e => setFormRegisto({...formRegisto, numero_identificacao: e.target.value})} className="ce-input matricula-style-100"  />
                      </div>
                    </div>
                  </div>

                  {/* ORIGEM E MORADA */}
                  <div className="matricula-style-102">
                    <div>
                      <label className="matricula-style-091">Região de Origem</label>
                      <select value={formRegisto.regiao_origem_key} onChange={e => { const key = e.target.value; const regObj = GUINE_REGIOES[key]; setFormRegisto({ ...formRegisto, regiao_origem_key: key, regiao_origem: regObj.nome, local_origem: regObj.locales[0] || "" }); }} className="ce-select matricula-style-100" >
                        {CHAVES_REGIOES.map(key => (<option key={key} value={key}>{GUINE_REGIOES[key].nome}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="matricula-style-091">Local de Origem / Sector</label>
                      <select value={formRegisto.local_origem} onChange={e => setFormRegisto({...formRegisto, local_origem: e.target.value})} className="ce-select matricula-style-100" >
                        {(GUINE_REGIOES[formRegisto.regiao_origem_key]?.locales || []).map(loc => (<option key={loc} value={loc}>{loc}</option>))}
                      </select>
                    </div>
                  </div>

                  <div className="matricula-style-103">
                    <div>
                      <label className="matricula-style-091">Região de Morada Atual</label>
                      <select value={formRegisto.regiao_morada_key} onChange={e => { const key = e.target.value; const regObj = GUINE_REGIOES[key]; setFormRegisto({ ...formRegisto, regiao_morada_key: key, regiao_morada: regObj.nome, setor_morada: regObj.locales[0] || "" }); }} className="ce-select matricula-style-100" >
                        {CHAVES_REGIOES.map(key => (<option key={key} value={key}>{GUINE_REGIOES[key].nome}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="matricula-style-091">Bairro / Sector de Morada</label>
                      <select value={formRegisto.setor_morada} onChange={e => setFormRegisto({...formRegisto, setor_morada: e.target.value})} className="ce-select matricula-style-100" >
                        {(GUINE_REGIOES[formRegisto.regiao_morada_key]?.locales || []).map(loc => (<option key={loc} value={loc}>{loc}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="matricula-style-091">Endereço Completo</label>
                      <input type="text" value={formRegisto.endereco_morada} onChange={e => setFormRegisto({...formRegisto, endereco_morada: e.target.value})} className="ce-input matricula-style-100"  placeholder="Rua / Casa nº" />
                    </div>
                  </div>

                  {/* HISTÓRICO ESCOLAR */}
                  <div className="matricula-style-104">
                    <div>
                      <label className="matricula-style-091">Última Escola Frequentada</label>
                      <input type="text" value={formRegisto.ultima_escola_frequentada} onChange={e => setFormRegisto({...formRegisto, ultima_escola_frequentada: e.target.value})} className="ce-input matricula-style-100"  placeholder="Nome da escola anterior" />
                    </div>
                    <div>
                      <label className="matricula-style-091">Última Nota / Média</label>
                      <input type="text" value={formRegisto.ultima_nota} onChange={e => setFormRegisto({...formRegisto, ultima_nota: e.target.value})} className="ce-input matricula-style-100"  placeholder="Ex: 14 valores" />
                    </div>
                  </div>

                  <div className="matricula-style-105">
                    <button type="button" onClick={() => setEtapa(2)} className="matricula-style-106">
                      Seguinte: Encarregado <BsArrowRight />
                    </button>
                  </div>
                </div>
              )}

              {/* ETAPA 2: ENCARREGADO DE EDUCAÇÃO */}
              {etapa === 2 && (
                <div>
                  <h3 className="matricula-style-089">
                    <BsPeople /> Passo 2: Dados Completos do Encarregado de Educação
                  </h3>
                  
                  <div className="matricula-style-107">
                    <div>
                      <label className="matricula-style-091">Nome *</label>
                      <input type="text" required value={formRegisto.encarregado_nome} onChange={e => setFormRegisto({...formRegisto, encarregado_nome: e.target.value})} className="ce-input matricula-style-100"  placeholder="Ex: Malam" />
                    </div>
                    <div>
                      <label className="matricula-style-091">Apelido *</label>
                      <input type="text" value={formRegisto.encarregado_apelido} onChange={e => setFormRegisto({...formRegisto, encarregado_apelido: e.target.value})} className="ce-input matricula-style-100"  placeholder="Ex: Baldé" />
                    </div>
                    <div>
                      <label className="matricula-style-091">Telemóvel *</label>
                      <GuineaBissauPhoneInput required value={formRegisto.encarregado_telefone} onChange={value => setFormRegisto(current => ({ ...current, encarregado_telefone: value }))} className="ce-input matricula-style-100"  placeholder="+245 96XXXXXXX" />
                    </div>
                    <div>
                      <label className="matricula-style-091">Email do encarregado (login) *</label>
                      <input type="email" required value={formRegisto.encarregado_email} onChange={e => setFormRegisto(current => ({ ...current, encarregado_email: e.target.value }))} className="ce-input matricula-style-100"  placeholder="encarregado@email.com" />
                    </div>
                  </div>

                  <div className="matricula-style-108">
                    <div>
                      <label className="matricula-style-091">Parentesco *</label>
                      <select value={formRegisto.parentesco} onChange={e => setFormRegisto({...formRegisto, parentesco: e.target.value})} className="ce-select matricula-style-100" >
                        <option value="Pai">Pai</option>
                        <option value="Mãe">Mãe</option>
                        <option value="Tio(a)">Tio(a)</option>
                        <option value="Tutor Legal">Tutor Legal</option>
                      </select>
                    </div>
                    <div>
                      <label className="matricula-style-091">Ocupação / Profissão</label>
                      <input type="text" value={formRegisto.encarregado_occupacao} onChange={e => setFormRegisto({...formRegisto, encarregado_occupacao: e.target.value})} className="ce-input matricula-style-100"  placeholder="Ex: Comerciante" />
                    </div>
                    <div>
                      <label className="matricula-style-091">Nº de ID / Bilhete</label>
                      <input type="text" value={formRegisto.encarregado_numero_identificacao} onChange={e => setFormRegisto({...formRegisto, encarregado_numero_identificacao: e.target.value})} className="ce-input matricula-style-100"  placeholder="Nº de BI" />
                    </div>
                  </div>

                  <div className="matricula-style-109">
                    <div>
                      <label className="matricula-style-091">Região de Morada (Encarregado)</label>
                      <select value={formRegisto.encarregado_regiao_key} onChange={e => { const key = e.target.value; const regObj = GUINE_REGIOES[key]; setFormRegisto({ ...formRegisto, encarregado_regiao_key: key, encarregado_regiao_morada: regObj.nome, encarregado_setor_morada: regObj.locales[0] || "" }); }} className="ce-select matricula-style-100" >
                        {CHAVES_REGIOES.map(key => (<option key={key} value={key}>{GUINE_REGIOES[key].nome}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="matricula-style-091">Bairro / Sector (Encarregado)</label>
                      <select value={formRegisto.encarregado_setor_morada} onChange={e => setFormRegisto({...formRegisto, encarregado_setor_morada: e.target.value})} className="ce-select matricula-style-100" >
                        {(GUINE_REGIOES[formRegisto.encarregado_regiao_key]?.locales || []).map(loc => (<option key={loc} value={loc}>{loc}</option>))}
                      </select>
                    </div>
                  </div>

                  <div className="matricula-style-110">
                    <button type="button" onClick={() => setEtapa(1)} className="matricula-style-111">
                      <BsArrowLeft /> Voltar
                    </button>
                    <button type="button" onClick={() => setEtapa(3)} className="matricula-style-106">
                      Seguinte: Revisão & Gravação <BsArrowRight />
                    </button>
                  </div>
                </div>
              )}

              {/* ETAPA 3: REVISÃO E CONFIRMAÇÃO DAS INFORMAÇÕES */}
              {etapa === 3 && (
                <div>
                  <h3 className="matricula-style-089">
                    <BsCheckLg /> Passo 3: Turma e Revisão Final
                  </h3>

                  <div className="matricula-style-112">
                    <label htmlFor="polo-matricula" className="matricula-style-113">
                      Ramo / polo para matrícula *
                    </label>
                    <select
                      id="polo-matricula"
                      value={poloMatriculaIdAtual}
                      onChange={(event) => {
                        setPoloMatriculaId(event.target.value);
                        setTurmaId('');
                      }}
                      required
                      disabled={!polos.some((polo) => polo.ativo)}
                      className="matricula-style-114"
                    >
                      <option value="">Selecione um ramo</option>
                      {polos.filter((polo) => polo.ativo).map((polo) => (
                        <option key={polo.id} value={String(polo.id)}>{polo.nome}</option>
                      ))}
                    </select>
                    <label htmlFor="turma-matricula" className="matricula-style-113">
                      Turma para matrícula no ano letivo {anoAberto?.ano_nome || 'ativo'} *
                    </label>
                    <select
                      id="turma-matricula"
                      value={turmaId}
                      onChange={(event) => setTurmaId(event.target.value)}
                      required
                      disabled={carregandoTurmas || Boolean(erroTurmas) || turmasDisponiveis.length === 0}
                      className="matricula-style-114"
                    >
                      <option value="">
                        {carregandoTurmas ? 'A carregar turmas...' : erroTurmas ? 'Erro ao carregar turmas' : turmasDisponiveis.length ? 'Selecione uma turma' : 'Não há turmas ativas neste ano letivo'}
                      </option>
                      {turmasDisponiveis.map((turma) => (
                        <option key={turma.id} value={turma.id}>
                          {[turma.polo_nome, turma.nome, turma.classe, turma.turno].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                    {erroTurmas && <p role="alert" className="matricula-style-115">{erroTurmas.message}</p>}
                    <p className="matricula-style-116">
                      A escolha do ano, ramo e turma é independente dos pagamentos. Registe os valores posteriormente na conta financeira do aluno.
                    </p>
                  </div>

                  <div className="matricula-style-117">
                    <div>
                      <h4 className="matricula-style-118">Dados do Aluno</h4>
                      <p className="matricula-style-119"><strong>Nome:</strong> {formRegisto.nome} {formRegisto.apelido}</p>
                      <p className="matricula-style-119"><strong>Telemóvel:</strong> {formRegisto.telefone}</p>
                      <p className="matricula-style-119"><strong>Email:</strong> {formRegisto.email}</p>
                      <p className="matricula-style-119"><strong>Género:</strong> {formRegisto.genero}</p>
                      <p className="matricula-style-119"><strong>Origem:</strong> {formRegisto.regiao_origem} ({formRegisto.local_origem})</p>
                      <p className="matricula-style-119"><strong>Morada:</strong> {formRegisto.regiao_morada} - {formRegisto.setor_morada}</p>
                    </div>

                    <div>
                      <h4 className="matricula-style-118">Dados do Encarregado</h4>
                      <p className="matricula-style-119"><strong>Nome:</strong> {formRegisto.encarregado_nome} {formRegisto.encarregado_apelido}</p>
                      <p className="matricula-style-119"><strong>Telemóvel:</strong> {formRegisto.encarregado_telefone}</p>
                      <p className="matricula-style-119"><strong>Email:</strong> {formRegisto.encarregado_email}</p>
                      <p className="matricula-style-119"><strong>Parentesco:</strong> {formRegisto.parentesco}</p>
                      <p className="matricula-style-119"><strong>Morada:</strong> {formRegisto.encarregado_regiao_morada} - {formRegisto.encarregado_setor_morada}</p>
                    </div>
                  </div>

                  <div className="matricula-style-110">
                    <button type="button" onClick={() => setEtapa(2)} className="matricula-style-111">
                      <BsArrowLeft /> Voltar para Editar
                    </button>
                    <button type="submit" disabled={loading} className="ce-btn-submit matricula-style-120" >
                      {loading ? 'A enviar...' : 'Enviar matrícula à Direção'}
                    </button>
                  </div>
                </div>
              )}

            </form>
          )}
        </div>
      )}

      {contasEncarregadoEncontradas && (
        <div className="matricula-encarregado-modal-overlay">
          <section
            className="matricula-encarregado-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="matricula-encarregado-modal-title"
          >
            <h2 id="matricula-encarregado-modal-title">Conta de encarregado encontrada</h2>
            <p>
              {contasEncarregadoEncontradas.length === 1
                ? 'O email ou telefone informado já pertence a esta conta. Confirme se pretende associá-la ao aluno. Mesmo que seja de outra escola, a conta será reutilizada sem duplicar nem alterar os seus dados.'
                : 'O email e o telefone informados pertencem a contas diferentes. Corrija os dados do encarregado para continuar.'}
            </p>
            <div className="matricula-encarregado-contas">
              {contasEncarregadoEncontradas.map((conta) => (
                <article key={conta.id} className="matricula-encarregado-conta">
                  <strong>
                    {conta.nome || 'Nome não informado'}
                    {conta.apelido && !String(conta.nome || '').trim().toLocaleLowerCase().endsWith(` ${conta.apelido.toLocaleLowerCase()}`)
                      ? ` ${conta.apelido}`
                      : ''}
                  </strong>
                  <span><b>Telefone:</b> {conta.telefone || 'Não registado'}</span>
                  <span><b>Email:</b> {conta.email || 'Não registado'}</span>
                  <small>
                    {conta.e_encarregado
                      ? 'Esta conta já tem perfil de encarregado.'
                      : 'Ao confirmar, será criado o vínculo de encarregado nesta escola.'}
                  </small>
                </article>
              ))}
            </div>
            <div className="matricula-encarregado-acoes">
              {contasEncarregadoEncontradas.length === 1 && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSubmeterRegisto(null, contasEncarregadoEncontradas[0])}
                  className="matricula-encarregado-confirmar"
                >
                  {loading ? 'A associar...' : 'Associar esta conta e continuar'}
                </button>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setContasEncarregadoEncontradas(null);
                  setEtapa(2);
                  setMensagem({
                    texto: 'Corrija todos os dados de contacto que pertençam a outra conta antes de continuar.',
                    tipo: 'erro'
                  });
                }}
                className="matricula-encarregado-corrigir"
              >
                Corrigir dados do encarregado
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}