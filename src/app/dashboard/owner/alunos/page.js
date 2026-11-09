'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@/styles/a3.css';
import { GUINE_REGIOES } from '@/utils/constantes';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_ALUNOS = `${API_BASE}/api/v1/alunos`;
const CHAVES_REGIOES = Object.keys(GUINE_REGIOES);

const CAMPOS_MANUAIS = [
  { key: 'nome', label: 'Nome do aluno', required: true },
  { key: 'apelido', label: 'Apelido do aluno' },
  { key: 'email', label: 'Email do aluno', type: 'email', required: true },
  { key: 'telefone', label: 'Telefone do aluno (+245)', required: true },
  { key: 'genero', label: 'Género', type: 'select', options: ['Masculino', 'Feminino'] },
  { key: 'data_nascimento', label: 'Data de nascimento', type: 'date' },
  { key: 'numero_identificacao', label: 'BI ou documento do aluno' },
  { key: 'nacionalidade', label: 'Nacionalidade' },
  { key: 'regiao_origem', label: 'Região de origem', type: 'regiao', keyField: 'regiao_origem_key' },
  { key: 'local_origem', label: 'Local de origem', type: 'local', keyField: 'regiao_origem_key' },
  { key: 'regiao_morada', label: 'Região de morada', type: 'regiao', keyField: 'regiao_morada_key' },
  { key: 'setor_morada', label: 'Setor de morada', type: 'local', keyField: 'regiao_morada_key' },
  { key: 'endereco_morada', label: 'Endereço de morada' },
  { key: 'ultima_escola_frequentada', label: 'Última escola frequentada' },
  { key: 'ultima_nota', label: 'Última nota' },
  { key: 'foto_arquivo', label: 'Fotografia do aluno (opcional)', type: 'image' },
  { key: 'numero_matricula', label: 'Número de matrícula (opcional)' },
  { key: 'observacoes', label: 'Observações da matrícula' },
  { key: 'encarregado_nome', label: 'Nome do encarregado', required: true },
  { key: 'encarregado_apelido', label: 'Apelido do encarregado' },
  { key: 'encarregado_telefone', label: 'Telefone do encarregado (+245)', required: true },
  { key: 'encarregado_email', label: 'Email do encarregado', type: 'email' },
  { key: 'parentesco', label: 'Parentesco', type: 'select', options: ['Pai', 'Mãe', 'Tio(a)', 'Tutor Legal'] },
  { key: 'contacto_principal', label: 'É o contacto principal?', type: 'checkbox' },
  { key: 'encarregado_occupacao', label: 'Ocupação do encarregado' },
  { key: 'encarregado_regiao_morada', label: 'Região de morada do encarregado', type: 'regiao', keyField: 'encarregado_regiao_key' },
  { key: 'encarregado_setor_morada', label: 'Setor de morada do encarregado', type: 'local', keyField: 'encarregado_regiao_key' },
  { key: 'encarregado_numero_identificacao', label: 'BI ou documento do encarregado' }
];

const CAMPOS_EDICAO_ALUNO = [
  { key: 'nome', label: 'Nome', required: true },
  { key: 'apelido', label: 'Apelido' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'genero', label: 'Género', type: 'select', options: ['Masculino', 'Feminino', 'Outro'] },
  { key: 'data_nascimento', label: 'Data de nascimento', type: 'date' },
  { key: 'numero_identificacao', label: 'BI ou documento' },
  { key: 'nacionalidade', label: 'Nacionalidade' },
  { key: 'regiao_origem', label: 'Região de origem' },
  { key: 'local_origem', label: 'Local de origem' },
  { key: 'regiao_morada', label: 'Região de morada' },
  { key: 'setor_morada', label: 'Setor de morada' },
  { key: 'endereco_morada', label: 'Endereço de morada' },
  { key: 'ultima_escola_frequentada', label: 'Última escola frequentada' },
  { key: 'ultima_nota', label: 'Última nota' },
  { key: 'status_ativo', label: 'Conta do aluno ativa', type: 'checkbox' }
];

const CAMPOS_EDICAO_ENCARREGADO = [
  { key: 'nome', label: 'Nome' },
  { key: 'apelido', label: 'Apelido' },
  { key: 'parentesco', label: 'Parentesco', type: 'select', options: ['Pai', 'Mãe', 'Tio(a)', 'Tutor Legal'] },
  { key: 'telefone', label: 'Telefone' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'occupacao', label: 'Ocupação' },
  { key: 'regiao_morada', label: 'Região de morada' },
  { key: 'setor_morada', label: 'Setor de morada' },
  { key: 'numero_identificacao', label: 'BI ou documento' },
  { key: 'contacto_principal', label: 'Contacto principal', type: 'checkbox' }
];

const FORMULARIO_VAZIO = Object.fromEntries(CAMPOS_MANUAIS.map(({ key }) => [key, '']));
const REGIAO_PADRAO = 'SAB';
const LOCAL_PADRAO = GUINE_REGIOES[REGIAO_PADRAO].locales[0] || '';

function criarFormularioManual() {
  return {
    ...FORMULARIO_VAZIO,
    genero: 'Masculino',
    nacionalidade: 'Guineense',
    regiao_origem_key: REGIAO_PADRAO,
    regiao_origem: GUINE_REGIOES[REGIAO_PADRAO].nome,
    local_origem: LOCAL_PADRAO,
    regiao_morada_key: REGIAO_PADRAO,
    regiao_morada: GUINE_REGIOES[REGIAO_PADRAO].nome,
    setor_morada: LOCAL_PADRAO,
    parentesco: 'Pai',
    contacto_principal: 'true',
    encarregado_regiao_key: REGIAO_PADRAO,
    encarregado_regiao_morada: GUINE_REGIOES[REGIAO_PADRAO].nome,
    encarregado_setor_morada: LOCAL_PADRAO,
    foto_preview: ''
  };
}

function nomeDaTurma(turma) {
  return [turma.classe, turma.nome, turma.turno, turma.sala].filter(Boolean).join(' · ');
}

async function lerResposta(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Não foi possível concluir o pedido.');
  }
  return data;
}

export default function ImportarAlunosOwnerPage() {
  const [aba, setAba] = useState('excel');
  const [escolas, setEscolas] = useState([]);
  const [escolaId, setEscolaId] = useState('');
  const [opcoes, setOpcoes] = useState({ escola: null, anos_letivos: [], polos: [], turmas: [] });
  const [anoLetivoId, setAnoLetivoId] = useState('');
  const [poloId, setPoloId] = useState('');
  const [turmaId, setTurmaId] = useState('');
  const [carregandoEscolas, setCarregandoEscolas] = useState(true);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [aCarregarFicheiro, setACarregarFicheiro] = useState(false);
  const [aImportar, setAImportar] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [linhas, setLinhas] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [formulariosManuais, setFormulariosManuais] = useState([{ ...criarFormularioManual(), __id: 0 }]);
  const [proximoIdManual, setProximoIdManual] = useState(1);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [arrastando, setArrastando] = useState(false);
  const [alunosExistentes, setAlunosExistentes] = useState([]);
  const [carregandoAlunos, setCarregandoAlunos] = useState(false);
  const [pesquisaAlunos, setPesquisaAlunos] = useState('');
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const [dadosEdicao, setDadosEdicao] = useState({});
  const [fotoEdicao, setFotoEdicao] = useState(null);
  const [fotoEdicaoPreview, setFotoEdicaoPreview] = useState('');
  const [carregandoFicha, setCarregandoFicha] = useState(false);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [alunosSelecionados, setAlunosSelecionados] = useState(new Set());
  const [aMoverTurma, setAMoverTurma] = useState(false);
  const [refreshAlunos, setRefreshAlunos] = useState(0);
  const previewsAtivos = useRef(new Set());

  useEffect(() => () => {
    previewsAtivos.current.forEach((url) => URL.revokeObjectURL(url));
    previewsAtivos.current.clear();
  }, []);

  const libertarPrevisualizacao = (url) => {
    if (!url || !previewsAtivos.current.has(url)) return;
    URL.revokeObjectURL(url);
    previewsAtivos.current.delete(url);
  };

  useEffect(() => {
    const controller = new AbortController();
    async function carregarEscolas() {
      try {
        const response = await fetch(`${API_ALUNOS}/importacao/escolas`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await lerResposta(response);
        const lista = Array.isArray(data.data) ? data.data : [];
        setEscolas(lista);
        setEscolaId(lista[0]?.id || '');
      } catch (errorCarregamento) {
        if (errorCarregamento.name !== 'AbortError') setErro(errorCarregamento.message);
      } finally {
        if (!controller.signal.aborted) setCarregandoEscolas(false);
      }
    }
    carregarEscolas();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!escolaId) return undefined;

    const controller = new AbortController();
    async function carregarOpcoes() {
      setCarregandoOpcoes(true);
      setErro('');
      try {
        const response = await fetch(`${API_ALUNOS}/${encodeURIComponent(escolaId)}/importacao/opcoes`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await lerResposta(response);
        const dados = data.data;
        const anos = Array.isArray(dados.anos_letivos) ? dados.anos_letivos : [];
        const polos = Array.isArray(dados.polos) ? dados.polos : [];
        const turmas = Array.isArray(dados.turmas) ? dados.turmas : [];
        const anoDefault = anos.find((ano) => ano.ativo)?.id || anos[0]?.id || '';
        const poloDefault = polos[0]?.id || '';
        setOpcoes({
          escola: dados.escola,
          anos_letivos: anos,
          polos,
          turmas
        });
        setAnoLetivoId(anoDefault);
        setPoloId(poloDefault);
        setTurmaId(turmas.find((turma) => turma.ano_letivo_id === anoDefault && turma.polo_id === poloDefault)?.id || '');
      } catch (errorCarregamento) {
        if (errorCarregamento.name !== 'AbortError') {
          setErro(errorCarregamento.message);
          setOpcoes({ escola: null, anos_letivos: [], polos: [], turmas: [] });
        }
      } finally {
        if (!controller.signal.aborted) setCarregandoOpcoes(false);
      }
    }
    carregarOpcoes();
    return () => controller.abort();
  }, [escolaId]);

  useEffect(() => {
    if (aba !== 'editar' || !escolaId || !anoLetivoId) return undefined;
    const controller = new AbortController();
    async function carregarAlunosExistentes() {
      setCarregandoAlunos(true);
      setErro('');
      try {
        const carregarGrupo = async ({ turmaSelecionada, situacaoTurma }) => {
          const parametros = new URLSearchParams({
            ano_letivo_id: anoLetivoId,
            situacao_turma: situacaoTurma,
            incluir_sem_matricula: 'true',
            somente_alunos: 'true'
          });
          if (poloId) parametros.set('polo_id', poloId);
          if (turmaSelecionada) parametros.set('turma_id', turmaSelecionada);
          const response = await fetch(`${API_ALUNOS}/${encodeURIComponent(escolaId)}/alunos?${parametros}`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          });
          const data = await lerResposta(response);
          return Array.isArray(data.data) ? data.data : [];
        };
        const [semTurma, turmaAtual] = await Promise.all([
          carregarGrupo({ situacaoTurma: 'sem_turma' }),
          turmaId
            ? carregarGrupo({ turmaSelecionada: turmaId, situacaoTurma: 'com_turma' })
            : Promise.resolve([])
        ]);
        setAlunosExistentes([...semTurma, ...turmaAtual]);
        setAlunosSelecionados(new Set());
      } catch (errorCarregamento) {
        if (errorCarregamento.name !== 'AbortError') setErro(errorCarregamento.message);
      } finally {
        if (!controller.signal.aborted) setCarregandoAlunos(false);
      }
    }
    carregarAlunosExistentes();
    return () => controller.abort();
  }, [aba, escolaId, anoLetivoId, poloId, turmaId, refreshAlunos]);

  const abrirEdicaoAluno = async (aluno) => {
    libertarPrevisualizacao(fotoEdicaoPreview);
    setAlunoSelecionado(aluno);
    setDadosEdicao({});
    setFotoEdicao(null);
    setFotoEdicaoPreview(aluno.foto_url || '');
    setErro('');
    setMensagem('');
    if (aluno.tem_notas) return;

    setCarregandoFicha(true);
    try {
      const response = await fetch(
        `${API_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/${encodeURIComponent(aluno.aluno_id)}/ficha`,
        { credentials: 'include', cache: 'no-store' }
      );
      const data = await lerResposta(response);
      const ficha = data.data;
      const alunoFicha = ficha.aluno || {};
      const utilizador = ficha.utilizador || {};
      setDadosEdicao({
        nome: utilizador.nome || '',
        apelido: alunoFicha.apelido || '',
        email: utilizador.email || '',
        telefone: utilizador.telefone || '',
        genero: alunoFicha.genero || '',
        data_nascimento: alunoFicha.data_nascimento ? String(alunoFicha.data_nascimento).slice(0, 10) : '',
        numero_identificacao: alunoFicha.numero_identificacao || '',
        nacionalidade: alunoFicha.nacionalidade || '',
        regiao_origem: alunoFicha.regiao_origem || '',
        local_origem: alunoFicha.local_origem || '',
        regiao_morada: alunoFicha.regiao_morada || '',
        setor_morada: alunoFicha.setor_morada || '',
        endereco_morada: alunoFicha.endereco_morada || '',
        ultima_escola_frequentada: alunoFicha.ultima_escola_frequentada || '',
        ultima_nota: alunoFicha.ultima_nota || '',
        status_ativo: utilizador.status_ativo === true,
        encarregados: (ficha.encarregados || []).map((encarregado) => ({
          id: encarregado.id,
          nome: encarregado.utilizador?.nome || '',
          apelido: encarregado.apelido || '',
          parentesco: encarregado.parentesco || '',
          telefone: encarregado.utilizador?.telefone || '',
          email: encarregado.utilizador?.email || '',
          occupacao: encarregado.occupacao || '',
          regiao_morada: encarregado.regiao_morada || '',
          setor_morada: encarregado.setor_morada || '',
          numero_identificacao: encarregado.numero_identificacao || '',
          contacto_principal: encarregado.contacto_principal === true
        }))
      });
      setFotoEdicaoPreview(alunoFicha.foto_url || '');
    } catch (errorFicha) {
      setErro(errorFicha.message);
      setAlunoSelecionado(null);
    } finally {
      setCarregandoFicha(false);
    }
  };

  const fecharEdicaoAluno = () => {
    libertarPrevisualizacao(fotoEdicaoPreview);
    setAlunoSelecionado(null);
    setDadosEdicao({});
    setFotoEdicao(null);
    setFotoEdicaoPreview('');
  };

  const salvarEdicaoAluno = async (event) => {
    event.preventDefault();
    if (!alunoSelecionado || alunoSelecionado.tem_notas) return;
    setSalvandoEdicao(true);
    setErro('');
    setMensagem('');
    try {
      const body = new FormData();
      Object.entries(dadosEdicao).forEach(([campo, valor]) => {
        if (campo !== 'encarregados' && valor !== undefined && valor !== null) {
          body.append(campo, String(valor));
        }
      });
      body.append('escola_id', escolaId);
      body.append('encarregados', JSON.stringify(dadosEdicao.encarregados || []));
      if (fotoEdicao) body.append('foto', fotoEdicao);
      const response = await fetch(`${API_ALUNOS}/${encodeURIComponent(alunoSelecionado.aluno_id)}`, {
        method: 'PUT',
        credentials: 'include',
        body
      });
      const data = await lerResposta(response);
      setMensagem(data.message || 'Dados do aluno atualizados com sucesso.');
      fecharEdicaoAluno();
      setRefreshAlunos((key) => key + 1);
    } catch (errorEdicao) {
      setErro(errorEdicao.message);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const alunosFiltrados = useMemo(() => {
    const termo = pesquisaAlunos.trim().toLocaleLowerCase();
    if (!termo) return alunosExistentes;
    return alunosExistentes.filter((aluno) => [
      aluno.nome,
      aluno.apelido,
      aluno.login_id,
      aluno.numero_matricula,
      aluno.telefone,
      aluno.encarregado_nome,
      aluno.encarregado_apelido,
      aluno.encarregado_telefone
    ].some((valor) => String(valor || '').toLocaleLowerCase().includes(termo)));
  }, [alunosExistentes, pesquisaAlunos]);

  const alunosSemTurma = useMemo(
    () => alunosFiltrados.filter((aluno) => !aluno.turma_id),
    [alunosFiltrados]
  );
  const alunosComTurma = useMemo(
    () => alunosFiltrados.filter((aluno) => aluno.turma_id),
    [alunosFiltrados]
  );

  const mudarTurmaAlunos = async (alunoIds) => {
    if (!escolaId || !anoLetivoId || !turmaId || !alunoIds.length || aMoverTurma) return;
    setAMoverTurma(true);
    setErro('');
    setMensagem('');
    try {
      const response = await fetch(`${API_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/mudar-turma`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aluno_ids: alunoIds,
          ano_letivo_id: anoLetivoId,
          turma_id: turmaId
        })
      });
      const data = await lerResposta(response);
      setMensagem(data.message || 'Os alunos foram colocados na turma selecionada.');
      setAlunosSelecionados(new Set());
      setRefreshAlunos((key) => key + 1);
    } catch (errorMovimento) {
      setErro(errorMovimento.message);
    } finally {
      setAMoverTurma(false);
    }
  };

  const turmasDisponiveis = useMemo(
    () => opcoes.turmas.filter((turma) => turma.ano_letivo_id === anoLetivoId && turma.polo_id === poloId),
    [opcoes.turmas, anoLetivoId, poloId]
  );

  const turmaSelecionada = turmasDisponiveis.find((turma) => turma.id === turmaId);
  const anoSelecionado = opcoes.anos_letivos.find((ano) => ano.id === anoLetivoId);
  const poloSelecionado = opcoes.polos.find((polo) => polo.id === poloId);
  const podeOperar = Boolean(escolaId && anoLetivoId && poloId && turmaId && !carregandoOpcoes);
  const podeDescarregarModelo = Boolean(escolaId && anoLetivoId && poloId && !carregandoOpcoes);

  const baixarModelo = () => {
    setErro('');
    setMensagem('');
    if (!podeDescarregarModelo) {
      setErro('Selecione a escola, o ano letivo e o polo antes de descarregar o modelo.');
      return;
    }

    const query = new URLSearchParams({
      ano_letivo_id: anoLetivoId,
      polo_id: poloId
    });
    if (turmaId) query.set('turma_id', turmaId);
    const link = document.createElement('a');
    link.href = `${API_ALUNOS}/${encodeURIComponent(escolaId)}/importacao/modelo?${query.toString()}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const validarFicheiro = async (ficheiro) => {
    if (!ficheiro) return;
    if (!podeOperar) {
      setErro('Selecione a escola, o ano letivo, o polo e a turma antes de importar.');
      return;
    }
    setErro('');
    setMensagem('');
    setResultados([]);
    limparLinhas();
    setACarregarFicheiro(true);
    try {
      const formData = new FormData();
      formData.append('ficheiro', ficheiro);
      const response = await fetch(
        `${API_ALUNOS}/${encodeURIComponent(escolaId)}/importacao/ficheiro`,
        { method: 'POST', credentials: 'include', body: formData }
      );
      const data = await lerResposta(response);
      setLinhas(data.data.map((aluno) => ({ ...aluno, __origem: 'Excel' })));
      setMensagem(`${data.total} aluno(s) foram lidos. Confira os dados antes de gravar.`);
    } catch (errorFicheiro) {
      limparLinhas();
      setErro(errorFicheiro.message);
    } finally {
      setACarregarFicheiro(false);
    }
  };

  const adicionarAlunoManual = (event) => {
    event.preventDefault();
    if (!podeOperar) {
      setErro('Selecione a escola, o ano letivo, o polo e a turma antes de continuar.');
      return;
    }
    setLinhas((atuais) => [
      ...atuais,
      ...formulariosManuais.map(({ __id, ...aluno }) => ({ ...aluno, __origem: 'Manual' }))
    ]);
    setFormulariosManuais([{ ...criarFormularioManual(), __id: proximoIdManual }]);
    setProximoIdManual((id) => id + 1);
    setResultados([]);
    setErro('');
    setMensagem(`${formulariosManuais.length} aluno(s) adicionado(s) à lista de revisão. As matrículas ainda não foram gravadas.`);
    setAba('excel');
  };

  const importarAlunos = async () => {
    if (!linhas.length || !podeOperar) return;
    setAImportar(true);
    setProgresso(0);
    setErro('');
    setMensagem('');
    const respostas = [];
    const falhas = [];

    for (let index = 0; index < linhas.length; index += 1) {
      const aluno = linhas[index];
      try {
        const dadosAluno = Object.fromEntries(
          Object.entries(aluno).filter(([chave]) => (
            !['__origem', '__id', 'foto_preview', 'foto_arquivo'].includes(chave)
            && !chave.endsWith('_key')
          ))
        );
        const fotoArquivo = aluno.foto_arquivo;
        const opcoesPedido = fotoArquivo
          ? (() => {
            const formData = new FormData();
            Object.entries({
              ...dadosAluno,
              polo_id: poloId,
              ano_letivo_id: anoLetivoId,
              turma_id: turmaId
            }).forEach(([chave, valor]) => {
              if (valor !== undefined && valor !== null) formData.append(chave, String(valor));
            });
            formData.append('foto', fotoArquivo);
            return { method: 'POST', credentials: 'include', body: formData };
          })()
          : {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...dadosAluno,
              polo_id: poloId,
              ano_letivo_id: anoLetivoId,
              turma_id: turmaId
            })
          };
        const response = await fetch(`${API_ALUNOS}/${encodeURIComponent(escolaId)}/alunos/matricular`, {
          ...opcoesPedido
        });
        const data = await lerResposta(response);
        respostas.push({
          nome: aluno.nome || `Linha ${index + 1}`,
          success: true,
          message: data.message,
          estado: data.data?.estado,
          numero_matricula: data.data?.numero_matricula
        });
      } catch (errorImportacao) {
        respostas.push({
          nome: aluno.nome || `Linha ${index + 1}`,
          success: false,
          message: errorImportacao.message
        });
        falhas.push(aluno);
      }
      setProgresso(Math.round(((index + 1) / linhas.length) * 100));
    }

    const falhasSet = new Set(falhas);
    linhas.filter((aluno) => !falhasSet.has(aluno)).forEach((aluno) => libertarPrevisualizacao(aluno.foto_preview));
    setResultados(respostas);
    setLinhas(falhas);
    setAImportar(false);
    const gravados = respostas.filter((resultado) => resultado.success).length;
    setMensagem(`${gravados} de ${respostas.length} matrícula(s) criada(s). Os alunos foram matriculados diretamente na turma selecionada.`);
  };

  const editarCampoManual = (id, campo, value) => {
    if (campo.type === 'image') {
      const formulario = formulariosManuais.find((item) => item.__id === id);
      if (value && !['image/jpeg', 'image/png', 'image/webp'].includes(value.type)) {
        setErro('A fotografia deve estar em formato JPG, PNG ou WEBP.');
        return;
      }
      if (value && value.size > 5 * 1024 * 1024) {
        setErro('A fotografia deve ter no máximo 5 MB.');
        return;
      }
      libertarPrevisualizacao(formulario?.foto_preview);
      const preview = value ? URL.createObjectURL(value) : '';
      if (preview) previewsAtivos.current.add(preview);
      setFormulariosManuais((atuais) => atuais.map((item) => (
        item.__id === id
          ? { ...item, foto_arquivo: value, foto_preview: preview }
          : item
      )));
      setErro('');
      return;
    }

    setFormulariosManuais((atuais) => atuais.map((formulario) => {
      if (formulario.__id !== id) return formulario;
      if (campo.type === 'regiao') {
        const regiao = GUINE_REGIOES[value];
        const campoLocalidade = CAMPOS_MANUAIS.find(
          (item) => item.keyField === campo.keyField && item.type === 'local'
        );
        return {
          ...formulario,
          [campo.keyField]: value,
          [campo.key]: regiao.nome,
          [campoLocalidade.key]: regiao.locales[0] || ''
        };
      }
      return { ...formulario, [campo.key]: value };
    }));
  };

  const removerFormularioManual = (formularioId) => {
    const formulario = formulariosManuais.find((item) => item.__id === formularioId);
    libertarPrevisualizacao(formulario?.foto_preview);
    setFormulariosManuais((atuais) => atuais.filter((item) => item.__id !== formularioId));
  };

  const limparLinhas = () => {
    linhas.forEach((aluno) => libertarPrevisualizacao(aluno.foto_preview));
    setLinhas([]);
  };

  return (
    <div className="owner-alunos-page import-content-wrapper">
      <header className="import-header-card">
        <div className="import-header-top">
          <div className="import-title-group">
            <h1>Matrícula e importação de alunos</h1>
            <p>Registe novos alunos ou atualize os dados dos alunos existentes em cada escola.</p>
          </div>
          <button type="button" className="btn-download-template" onClick={baixarModelo} disabled={!podeDescarregarModelo}>
            Descarregar modelo Excel (.xlsx)
          </button>
        </div>
        <nav className="import-tabs-nav" aria-label="Modo de registo">
          <button type="button" className={`tab-btn ${aba === 'excel' ? 'active' : ''}`} onClick={() => setAba('excel')}>
            Importar Excel / CSV
          </button>
          <button type="button" className={`tab-btn ${aba === 'manual' ? 'active' : ''}`} onClick={() => setAba('manual')}>
            Registar manualmente
          </button>
          <button type="button" className={`tab-btn ${aba === 'editar' ? 'active' : ''}`} onClick={() => setAba('editar')}>
            Consultar / editar alunos
          </button>
        </nav>
      </header>

      <section className="school-selector-card" aria-label="Destino da matrícula">
        <div className="form-select-group">
          <label htmlFor="escolaDestino">Escola *</label>
          <select
            id="escolaDestino"
            className="select-clay"
            value={escolaId}
            onChange={(event) => {
              setEscolaId(event.target.value);
              setOpcoes({ escola: null, anos_letivos: [], polos: [], turmas: [] });
              setAnoLetivoId('');
              setPoloId('');
              setTurmaId('');
              limparLinhas();
              setResultados([]);
              setAlunosExistentes([]);
              setAlunosSelecionados(new Set());
              setPesquisaAlunos('');
              fecharEdicaoAluno();
            }}
            disabled={carregandoEscolas || !escolas.length || carregandoFicha || salvandoEdicao}
          >
            <option value="">{carregandoEscolas ? 'A carregar escolas...' : 'Selecione uma escola'}</option>
            {escolas.map((escola) => <option key={escola.id} value={escola.id}>{escola.nome}</option>)}
          </select>
        </div>
        <div className="form-select-group">
          <label htmlFor="anoDestino">Ano letivo *</label>
          <select
            id="anoDestino"
            className="select-clay"
            value={anoLetivoId}
            onChange={(event) => {
              const novoAnoId = event.target.value;
              setAnoLetivoId(novoAnoId);
              setTurmaId(opcoes.turmas.find((turma) => turma.ano_letivo_id === novoAnoId && turma.polo_id === poloId)?.id || '');
              setLinhas([]);
              setResultados([]);
              setAlunosSelecionados(new Set());
            }}
            disabled={carregandoOpcoes || !opcoes.anos_letivos.length}
          >
            <option value="">Selecione o ano letivo</option>
            {opcoes.anos_letivos.map((ano) => (
              <option key={ano.id} value={ano.id}>{ano.ano_nome}{ano.ativo ? ' · ativo' : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-select-group">
          <label htmlFor="poloDestino">Polo *</label>
          <select
            id="poloDestino"
            className="select-clay"
            value={poloId}
            onChange={(event) => {
              const novoPoloId = event.target.value;
              setPoloId(novoPoloId);
              setTurmaId(opcoes.turmas.find((turma) => turma.ano_letivo_id === anoLetivoId && turma.polo_id === novoPoloId)?.id || '');
              setLinhas([]);
              setResultados([]);
              setAlunosSelecionados(new Set());
            }}
            disabled={carregandoOpcoes || !opcoes.polos.length}
          >
            <option value="">Selecione o polo</option>
            {opcoes.polos.map((polo) => (
              <option key={polo.id} value={polo.id}>{polo.nome}{polo.codigo ? ` (${polo.codigo})` : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-select-group">
          <label htmlFor="turmaDestino">Turma *</label>
          <select
            id="turmaDestino"
            className="select-clay"
            value={turmaId}
            onChange={(event) => { setTurmaId(event.target.value); setLinhas([]); setResultados([]); }}
            disabled={carregandoOpcoes || !turmasDisponiveis.length}
          >
            <option value="">{turmasDisponiveis.length ? 'Selecione a turma' : 'Sem turmas para esta seleção'}</option>
            {turmasDisponiveis.map((turma) => (
              <option key={turma.id} value={turma.id}>{nomeDaTurma(turma)}</option>
            ))}
          </select>
        </div>
      </section>

      {opcoes.escola && (
        <section className="import-header-card import-school-info" aria-label="Dados da escola selecionada">
          <strong>{opcoes.escola.nome} ({opcoes.escola.sigla})</strong>
          <span>
            {[opcoes.escola.local, opcoes.escola.sector, poloSelecionado?.nome, anoSelecionado?.ano_nome, turmaSelecionada && nomeDaTurma(turmaSelecionada)]
              .filter(Boolean).join(' · ')}
          </span>
          {(opcoes.escola.visao || opcoes.escola.motto) && (
            <small>{[opcoes.escola.motto, opcoes.escola.visao].filter(Boolean).join(' — ')}</small>
          )}
        </section>
      )}

      {erro && <div role="alert" className="import-message import-message-error">{erro}</div>}
      {mensagem && <div role="status" className="import-message import-message-success">{mensagem}</div>}

      {aba === 'excel' ? (
        <section>
          <div
            className={`dropzone-card ${arrastando ? 'dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(event) => {
              event.preventDefault();
              setArrastando(false);
              validarFicheiro(event.dataTransfer.files?.[0]);
            }}
          >
            <input
              type="file"
              id="excelFileInput"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(event) => {
                validarFicheiro(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <div className="dropzone-text">
              <h3>{aCarregarFicheiro ? 'A validar o ficheiro...' : 'Arraste o modelo preenchido para aqui'}</h3>
              <p>ou <label htmlFor="excelFileInput">selecione um ficheiro</label> XLSX, XLS ou CSV (máximo de 500 alunos).</p>
              <p>Use a folha “Alunos” do modelo e não altere os títulos das colunas.</p>
              {!turmasDisponiveis.length && <p>Não há turmas ativas neste polo e ano. Pode descarregar um modelo geral; selecione/crie uma turma antes de gravar alunos.</p>}
            </div>
          </div>

          {linhas.length > 0 && (
            <section className="manual-entry-card import-review-card">
              <h2>Revisão antes de gravar ({linhas.length})</h2>
              <p>Destino: {opcoes.escola?.nome} · {poloSelecionado?.nome} · {anoSelecionado?.ano_nome} · {turmaSelecionada && nomeDaTurma(turmaSelecionada)}</p>
              <p>Os alunos serão matriculados diretamente na turma selecionada. O Owner pode dispensar talão e prazo.</p>
              <div className="table-responsive">
                <table className="clay-table">
                  <thead>
                    <tr><th>Foto</th><th>Aluno</th><th>Email</th><th>Telefone</th><th>Encarregado</th><th>Contacto do encarregado</th><th>Origem</th><th /></tr>
                  </thead>
                  <tbody>
                    {linhas.map((aluno, index) => (
                      <tr key={`${aluno.email || aluno.nome}-${index}`}>
                        <td>
                          {(aluno.foto_preview || aluno.foto_url) && (
                            <img
                              className="manual-student-thumbnail"
                              src={aluno.foto_preview || aluno.foto_url}
                              alt={`Fotografia de ${aluno.nome || 'aluno'}`}
                            />
                          )}
                        </td>
                        <td>{[aluno.nome, aluno.apelido].filter(Boolean).join(' ')}</td>
                        <td>{aluno.email}</td>
                        <td>{aluno.telefone}</td>
                        <td>{[aluno.encarregado_nome, aluno.encarregado_apelido].filter(Boolean).join(' ')}</td>
                        <td>{aluno.encarregado_telefone}</td>
                        <td>{aluno.__origem || 'Excel'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-remove-row"
                            title="Remover aluno da lista"
                            onClick={() => {
                              libertarPrevisualizacao(aluno.foto_preview);
                              setLinhas((atuais) => atuais.filter((_, linhaIndex) => linhaIndex !== index));
                            }}
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {aImportar && (
                <div className="import-progress">
                  <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${progresso}%` }} /></div>
                  <p>{progresso}% processado</p>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-modal-cancel" onClick={limparLinhas} disabled={aImportar}>Limpar lista</button>
                <button type="button" className="btn-modal-confirm" onClick={importarAlunos} disabled={aImportar || !podeOperar}>
                  {aImportar ? 'A gravar...' : `Criar ${linhas.length} matrícula(s)`}
                </button>
              </div>
            </section>
          )}

          {resultados.length > 0 && (
            <section className="manual-entry-card import-review-card">
              <h2>Resultado da importação</h2>
              <div className="preview-list-box">
                {resultados.map((resultado, index) => (
                  <div className="preview-item" key={`${resultado.nome}-${index}`}>
                    <div>
                      <div className="preview-name">{resultado.nome}</div>
                      <div className="preview-sub">{resultado.message}{resultado.numero_matricula ? ` · ${resultado.numero_matricula}` : ''}</div>
                    </div>
                    <span className={resultado.success ? 'badge-status-success' : 'badge-status-pending'}>
                      {resultado.success
                        ? resultado.estado === 'ativa' ? 'Criada · ativa' : 'Criada · pendente'
                        : 'Erro'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>
      ) : aba === 'manual' ? (
        <form onSubmit={adicionarAlunoManual} className="manual-entry-card">
          <div className="manual-list-heading">
            <div>
              <h2>Registar alunos manualmente</h2>
              <p>Preencha uma linha por aluno. Os campos com padrão seguem os valores da matrícula da Secretaria e podem ser alterados.</p>
            </div>
            <span className="manual-row-count">{formulariosManuais.length} aluno(s)</span>
          </div>
          {formulariosManuais.map((formulario, indiceFormulario) => (
            <section className="manual-student-row" key={formulario.__id}>
              <div className="manual-student-row-heading">
                <h3>Aluno {indiceFormulario + 1}</h3>
                {formulariosManuais.length > 1 && (
                  <button
                    type="button"
                    className="manual-remove-student"
                    onClick={() => removerFormularioManual(formulario.__id)}
                    disabled={aImportar}
                  >
                    Remover aluno
                  </button>
                )}
              </div>
              <div className="manual-fields-grid">
                {CAMPOS_MANUAIS.map((campo) => {
                  const idCampo = `campo-${formulario.__id}-${campo.key}`;
                  const regioesLocais = GUINE_REGIOES[formulario[campo.keyField]]?.locales || [];
                  return (
                    <div className="form-select-group" key={campo.key}>
                      <label htmlFor={idCampo}>{campo.label}{campo.required ? ' *' : ''}</label>
                      {campo.type === 'regiao' ? (
                        <select
                          id={idCampo}
                          className="select-clay"
                          value={formulario[campo.keyField]}
                          required={campo.required}
                          onChange={(event) => editarCampoManual(formulario.__id, campo, event.target.value)}
                        >
                          {CHAVES_REGIOES.map((chave) => (
                            <option key={chave} value={chave}>{GUINE_REGIOES[chave].nome}</option>
                          ))}
                        </select>
                      ) : campo.type === 'local' ? (
                        <select
                          id={idCampo}
                          className="select-clay"
                          value={formulario[campo.key]}
                          required={campo.required}
                          onChange={(event) => editarCampoManual(formulario.__id, campo, event.target.value)}
                        >
                          {regioesLocais.map((local) => <option key={local} value={local}>{local}</option>)}
                        </select>
                      ) : campo.type === 'select' ? (
                        <select
                          id={idCampo}
                          className="select-clay"
                          value={formulario[campo.key]}
                          required={campo.required}
                          onChange={(event) => editarCampoManual(formulario.__id, campo, event.target.value)}
                        >
                          {campo.options.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
                        </select>
                      ) : campo.type === 'checkbox' ? (
                        <label className="manual-checkbox-control" htmlFor={idCampo}>
                          <input
                            id={idCampo}
                            type="checkbox"
                            checked={formulario[campo.key] === 'true'}
                            onChange={(event) => editarCampoManual(
                              formulario.__id,
                              campo,
                              event.target.checked ? 'true' : 'false'
                            )}
                          />
                          <span>{formulario[campo.key] === 'true' ? 'Sim, contacto principal' : 'Não é o contacto principal'}</span>
                        </label>
                      ) : campo.type === 'image' ? (
                        <div className="manual-photo-control">
                          <input
                            id={idCampo}
                            className="table-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              const ficheiro = event.target.files?.[0] || null;
                              event.target.value = '';
                              editarCampoManual(formulario.__id, campo, ficheiro);
                            }}
                          />
                          {formulario.foto_preview && (
                            <img
                              className="manual-photo-preview"
                              src={formulario.foto_preview}
                              alt={`Pré-visualização da fotografia de ${formulario.nome || 'aluno'}`}
                            />
                          )}
                          {formulario.foto_arquivo && (
                            <button
                              type="button"
                              className="manual-remove-student"
                              onClick={() => editarCampoManual(formulario.__id, campo, null)}
                            >
                              Remover fotografia
                            </button>
                          )}
                          <small>JPG, PNG ou WEBP; máximo de 5 MB.</small>
                        </div>
                      ) : (
                        <input
                          id={idCampo}
                          className="table-input"
                          type={campo.type || 'text'}
                          value={formulario[campo.key]}
                          required={campo.required}
                          onChange={(event) => editarCampoManual(formulario.__id, campo, event.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <div className="manual-list-actions">
            <button
              type="button"
              className="btn-add-student-row"
              onClick={() => {
                setFormulariosManuais((atuais) => [...atuais, { ...criarFormularioManual(), __id: proximoIdManual }]);
                setProximoIdManual((id) => id + 1);
              }}
              disabled={aImportar || formulariosManuais.length >= 500}
            >
              + Adicionar outra linha
            </button>
            <button type="submit" className="btn-submit-all" disabled={!podeOperar || aImportar}>
              Rever {formulariosManuais.length} aluno(s) antes de gravar
            </button>
          </div>
        </form>
      ) : (
        <>
          <section className="manual-entry-card owner-students-card">
            <div className="manual-list-heading">
              <div>
                <h2>Consultar ou editar alunos</h2>
                <p>Os alunos estão separados pela situação da turma. Pesquise pelo nome, matrícula, telefone ou encarregado.</p>
              </div>
              <button
                type="button"
                className="btn-add-student-row"
                onClick={() => setRefreshAlunos((key) => key + 1)}
                disabled={carregandoAlunos || !escolaId}
              >
                Atualizar lista
              </button>
            </div>
            <div className="form-select-group owner-students-search">
              <label htmlFor="pesquisaAlunos">Pesquisar aluno</label>
              <input
                id="pesquisaAlunos"
                className="table-input"
                type="search"
                value={pesquisaAlunos}
                onChange={(event) => setPesquisaAlunos(event.target.value)}
                placeholder="Nome, matrícula, telefone ou encarregado"
              />
            </div>
            {carregandoAlunos ? (
              <p className="owner-students-empty">A carregar alunos...</p>
            ) : alunosExistentes.length === 0 ? (
              <p className="owner-students-empty">Não foram encontrados alunos nesta escola.</p>
            ) : alunosFiltrados.length === 0 ? (
              <p className="owner-students-empty">Nenhum aluno corresponde à pesquisa.</p>
            ) : (
              <>
                <section className="owner-student-group" aria-labelledby="owner-no-class-heading">
                  <div className="owner-student-group-heading">
                    <div>
                      <h3 id="owner-no-class-heading">Alunos sem turma</h3>
                      <p>Selecione um ou vários alunos e atribua-os à turma escolhida acima.</p>
                    </div>
                    <span className="owner-student-group-count">{alunosSemTurma.length} aluno(s)</span>
                  </div>
                  {alunosSemTurma.length > 0 && (
                    <div className="owner-student-move-actions">
                      <label className="owner-student-select-all">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os alunos sem turma"
                          checked={alunosSemTurma.every((aluno) => alunosSelecionados.has(aluno.aluno_id))}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setAlunosSelecionados((atuais) => new Set([
                                ...atuais,
                                ...alunosSemTurma.map((aluno) => aluno.aluno_id)
                              ]));
                            } else {
                              const semTurmaVisiveis = new Set(alunosSemTurma.map((aluno) => aluno.aluno_id));
                              setAlunosSelecionados((atuais) => new Set([...atuais].filter((id) => !semTurmaVisiveis.has(id))));
                            }
                          }}
                        />
                        Selecionar todos os resultados sem turma
                      </label>
                      <span>{alunosSelecionados.size} selecionado(s)</span>
                      <button
                        type="button"
                        className="btn-modal-confirm"
                        onClick={() => mudarTurmaAlunos([...alunosSelecionados])}
                        disabled={!alunosSelecionados.size || !turmaSelecionada || aMoverTurma || carregandoAlunos}
                      >
                        {aMoverTurma ? 'A matricular...' : `Matricular selecionado(s)${turmaSelecionada ? ` em ${nomeDaTurma(turmaSelecionada)}` : ''}`}
                      </button>
                    </div>
                  )}
                  {alunosSemTurma.length > 0 ? (
                    <div className="table-responsive">
                      <table className="clay-table owner-students-table">
                        <thead>
                          <tr>
                            <th>Selecionar</th>
                            <th>Aluno</th><th>Matrícula</th><th>Encarregado</th><th>Notas</th><th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {alunosSemTurma.map((aluno) => (
                            <tr key={aluno.aluno_id}>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar ${aluno.nome} ${aluno.apelido || ''}`}
                                  checked={alunosSelecionados.has(aluno.aluno_id)}
                                  onChange={(event) => setAlunosSelecionados((atuais) => {
                                    const atualizados = new Set(atuais);
                                    if (event.target.checked) atualizados.add(aluno.aluno_id);
                                    else atualizados.delete(aluno.aluno_id);
                                    return atualizados;
                                  })}
                                />
                              </td>
                              <td>{[aluno.nome, aluno.apelido].filter(Boolean).join(' ')}</td>
                              <td>{aluno.numero_matricula || aluno.login_id || '—'}</td>
                              <td>{[aluno.encarregado_nome, aluno.encarregado_apelido].filter(Boolean).join(' ') || '—'}</td>
                              <td>{aluno.tem_notas ? 'Registadas' : 'Sem notas'}</td>
                              <td>
                                <div className="owner-student-row-actions">
                                  <button
                                    type="button"
                                    className="btn-add-student-row"
                                    onClick={() => mudarTurmaAlunos([aluno.aluno_id])}
                                    disabled={!turmaSelecionada || aMoverTurma || carregandoFicha}
                                  >
                                    {aMoverTurma ? 'A matricular...' : 'Matricular'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-add-student-row"
                                    onClick={() => abrirEdicaoAluno(aluno)}
                                    disabled={carregandoFicha}
                                  >
                                    {aluno.tem_notas ? 'Ver bloqueio' : 'Editar dados'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="owner-students-empty">Todos os alunos encontrados já têm turma.</p>
                  )}
                </section>

                <section className="owner-student-group" aria-labelledby="owner-with-class-heading">
                  <div className="owner-student-group-heading">
                    <div>
                      <h3 id="owner-with-class-heading">Alunos com turma</h3>
                      <p>Consulte a turma atual, edite os dados ou mude um aluno de turma.</p>
                    </div>
                    <span className="owner-student-group-count">{alunosComTurma.length} aluno(s)</span>
                  </div>
                  {alunosComTurma.length > 0 ? (
                    <div className="table-responsive">
                      <table className="clay-table owner-students-table">
                        <thead>
                          <tr>
                            <th>Aluno</th><th>Matrícula</th><th>Turma</th><th>Encarregado</th><th>Notas</th><th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {alunosComTurma.map((aluno) => (
                            <tr key={aluno.aluno_id}>
                              <td>{[aluno.nome, aluno.apelido].filter(Boolean).join(' ')}</td>
                              <td>{aluno.numero_matricula || aluno.login_id || '—'}</td>
                              <td>{aluno.turma_nome}</td>
                              <td>{[aluno.encarregado_nome, aluno.encarregado_apelido].filter(Boolean).join(' ') || '—'}</td>
                              <td>{aluno.tem_notas ? 'Registadas' : 'Sem notas'}</td>
                              <td>
                                <div className="owner-student-row-actions">
                                  <button
                                    type="button"
                                    className="btn-add-student-row"
                                    onClick={() => mudarTurmaAlunos([aluno.aluno_id])}
                                    disabled={!turmaSelecionada || aMoverTurma || carregandoFicha || aluno.tem_notas}
                                  >
                                    {aMoverTurma ? 'A mudar...' : 'Mudar turma'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-add-student-row"
                                    onClick={() => abrirEdicaoAluno(aluno)}
                                    disabled={carregandoFicha}
                                  >
                                    {aluno.tem_notas ? 'Ver bloqueio' : 'Editar dados'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="owner-students-empty">Ainda não há alunos com turma.</p>
                  )}
                </section>
              </>
            )}
          </section>

          {alunoSelecionado && (
            <section className="manual-entry-card owner-student-edit-card">
              <div className="manual-list-heading">
                <div>
                  <h2>Editar dados de {alunoSelecionado.nome} {alunoSelecionado.apelido}</h2>
                  <p>{opcoes.escola?.nome || 'Escola selecionada'}</p>
                </div>
                <button type="button" className="btn-add-student-row" onClick={fecharEdicaoAluno}>
                  Fechar
                </button>
              </div>
              {alunoSelecionado.tem_notas ? (
                <div className="owner-student-grade-lock" role="status">
                  Este aluno já tem notas registadas nesta escola. Os dados não podem ser alterados.
                </div>
              ) : carregandoFicha ? (
                <p className="owner-students-empty">A carregar a ficha do aluno...</p>
              ) : (
                <form onSubmit={salvarEdicaoAluno}>
                  <section className="owner-edit-section">
                    <h3>Dados do aluno</h3>
                    <div className="manual-photo-control owner-edit-photo">
                      {fotoEdicaoPreview && (
                        <img className="manual-photo-preview" src={fotoEdicaoPreview} alt={`Fotografia de ${dadosEdicao.nome || 'aluno'}`} />
                      )}
                      <label htmlFor="fotoEdicaoAluno">Fotografia (JPG, PNG ou WEBP; máximo 5 MB)</label>
                      <input
                        id="fotoEdicaoAluno"
                        className="table-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          const ficheiro = event.target.files?.[0] || null;
                          event.target.value = '';
                          if (ficheiro && !['image/jpeg', 'image/png', 'image/webp'].includes(ficheiro.type)) {
                            setErro('A fotografia deve estar em formato JPG, PNG ou WEBP.');
                            return;
                          }
                          if (ficheiro && ficheiro.size > 5 * 1024 * 1024) {
                            setErro('A fotografia deve ter no máximo 5 MB.');
                            return;
                          }
                          libertarPrevisualizacao(fotoEdicaoPreview);
                          const preview = ficheiro ? URL.createObjectURL(ficheiro) : '';
                          if (preview) previewsAtivos.current.add(preview);
                          setFotoEdicao(ficheiro);
                          setFotoEdicaoPreview(preview || alunoSelecionado.foto_url || '');
                          setErro('');
                        }}
                      />
                    </div>
                    <div className="manual-fields-grid">
                      {CAMPOS_EDICAO_ALUNO.map((campo) => (
                        <div className="form-select-group" key={campo.key}>
                          {campo.type === 'checkbox' ? (
                            <label className="manual-checkbox-control">
                              <input
                                type="checkbox"
                                checked={dadosEdicao[campo.key] === true}
                                onChange={(event) => setDadosEdicao((atual) => ({ ...atual, [campo.key]: event.target.checked }))}
                              />
                              <span>{campo.label}</span>
                            </label>
                          ) : (
                            <>
                              <label htmlFor={`edicao-aluno-${campo.key}`}>{campo.label}</label>
                              {campo.type === 'select' ? (
                                <select
                                  id={`edicao-aluno-${campo.key}`}
                                  className="select-clay"
                                  value={dadosEdicao[campo.key] || ''}
                                  onChange={(event) => setDadosEdicao((atual) => ({ ...atual, [campo.key]: event.target.value }))}
                                >
                                  <option value="">Não informado</option>
                                  {campo.options.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
                                </select>
                              ) : (
                                <input
                                  id={`edicao-aluno-${campo.key}`}
                                  className="table-input"
                                  type={campo.type || 'text'}
                                  required={campo.required}
                                  value={dadosEdicao[campo.key] || ''}
                                  onChange={(event) => setDadosEdicao((atual) => ({ ...atual, [campo.key]: event.target.value }))}
                                />
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="owner-edit-section">
                    <h3>Encarregados de educação</h3>
                    {dadosEdicao.encarregados?.length ? dadosEdicao.encarregados.map((encarregado, index) => (
                      <div className="owner-edit-guardian" key={encarregado.id}>
                        <h4>{encarregado.nome || `Encarregado ${index + 1}`}</h4>
                        <div className="manual-fields-grid">
                          {CAMPOS_EDICAO_ENCARREGADO.map((campo) => (
                            <div className="form-select-group" key={campo.key}>
                              {campo.type === 'checkbox' ? (
                                <label className="manual-checkbox-control">
                                  <input
                                    type="checkbox"
                                    checked={encarregado[campo.key] === true}
                                    onChange={(event) => setDadosEdicao((atual) => ({
                                      ...atual,
                                      encarregados: atual.encarregados.map((item, itemIndex) => (
                                        itemIndex === index ? { ...item, [campo.key]: event.target.checked } : item
                                      ))
                                    }))}
                                  />
                                  <span>{campo.label}</span>
                                </label>
                              ) : (
                                <>
                                  <label htmlFor={`edicao-encarregado-${index}-${campo.key}`}>{campo.label}</label>
                                  {campo.type === 'select' ? (
                                    <select
                                      id={`edicao-encarregado-${index}-${campo.key}`}
                                      className="select-clay"
                                      value={encarregado[campo.key] || ''}
                                      onChange={(event) => setDadosEdicao((atual) => ({
                                        ...atual,
                                        encarregados: atual.encarregados.map((item, itemIndex) => (
                                          itemIndex === index ? { ...item, [campo.key]: event.target.value } : item
                                        ))
                                      }))}
                                    >
                                      <option value="">Não informado</option>
                                      {campo.options.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
                                    </select>
                                  ) : (
                                    <input
                                      id={`edicao-encarregado-${index}-${campo.key}`}
                                      className="table-input"
                                      type={campo.type || 'text'}
                                      value={encarregado[campo.key] || ''}
                                      onChange={(event) => setDadosEdicao((atual) => ({
                                        ...atual,
                                        encarregados: atual.encarregados.map((item, itemIndex) => (
                                          itemIndex === index ? { ...item, [campo.key]: event.target.value } : item
                                        ))
                                      }))}
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )) : <p className="owner-students-empty">Não há encarregados associados a este aluno.</p>}
                  </section>
                  <div className="manual-list-actions">
                    <button type="button" className="btn-add-student-row" onClick={fecharEdicaoAluno} disabled={salvandoEdicao}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn-submit-all" disabled={salvandoEdicao}>
                      {salvandoEdicao ? 'A guardar...' : 'Guardar alterações'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
