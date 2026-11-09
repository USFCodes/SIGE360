const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const REPORT_URL = `${API_BASE}/api/v1/owner/support/errors/report`;
const API_ORIGIN = new URL(API_BASE, window.location.origin).origin;
const REPORT_PATH = new URL(REPORT_URL, window.location.origin).pathname;
const RECENT_ERRORS = new Map();
const DEDUPE_WINDOW_MS = 60_000;

function caminhoSemParametros(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname.slice(0, 500);
  } catch {
    return '';
  }
}

function enviarOcorrencia(dados) {
  const chave = [dados.tipo, dados.status_http, dados.metodo, dados.rota, dados.mensagem].join('|');
  const agora = Date.now();
  if (agora - (RECENT_ERRORS.get(chave) || 0) < DEDUPE_WINDOW_MS) return;
  RECENT_ERRORS.set(chave, agora);
  if (RECENT_ERRORS.size > 200) {
    for (const [erro, instante] of RECENT_ERRORS) {
      if (agora - instante >= DEDUPE_WINDOW_MS) RECENT_ERRORS.delete(erro);
    }
  }

  const payload = {
    ...dados,
    pagina: caminhoSemParametros(window.location.href),
    user_agent: navigator.userAgent.slice(0, 500)
  };
  void window.fetch(REPORT_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch((error) => {
    console.warn('[ERROR REPORTING] Não foi possível enviar a ocorrência automática:', error);
  });
}

const fetchOriginal = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
  const requestMethod = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  let url;
  try {
    url = new URL(requestUrl, window.location.origin);
  } catch {
    return fetchOriginal(input, init);
  }

  const deveCapturar = url.origin === API_ORIGIN && url.pathname.startsWith('/api/v1/')
    && url.pathname !== REPORT_PATH;
  try {
    const response = await fetchOriginal(input, init);
    if (deveCapturar && !response.ok) {
      void response.clone().json().then((data) => {
        enviarOcorrencia({
          tipo: 'http',
          status_http: response.status,
          metodo: requestMethod,
          rota: url.pathname.slice(0, 500),
          mensagem: String(data?.message || `Pedido falhou (HTTP ${response.status}).`).slice(0, 2000)
        });
      }).catch(() => {
        enviarOcorrencia({
          tipo: 'http',
          status_http: response.status,
          metodo: requestMethod,
          rota: url.pathname.slice(0, 500),
          mensagem: `Pedido falhou (HTTP ${response.status}).`
        });
      });
    }
    return response;
  } catch (error) {
    if (deveCapturar && error?.name !== 'AbortError') {
      enviarOcorrencia({
        tipo: 'rede',
        status_http: 0,
        metodo: requestMethod,
        rota: url.pathname.slice(0, 500),
        mensagem: String(error?.message || 'Falha de rede ao comunicar com a API.').slice(0, 2000)
      });
    }
    throw error;
  }
};

window.addEventListener('error', (event) => {
  if (!event.error) return;
  enviarOcorrencia({
    tipo: 'javascript',
    status_http: null,
    metodo: null,
    rota: caminhoSemParametros(event.filename || window.location.href),
    mensagem: String(event.message || event.error.message || 'Erro JavaScript.').slice(0, 2000),
    stack: String(event.error.stack || '').slice(0, 6000)
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  enviarOcorrencia({
    tipo: 'promise',
    status_http: null,
    metodo: null,
    rota: caminhoSemParametros(window.location.href),
    mensagem: String(error?.message || error || 'Promise rejeitada sem tratamento.').slice(0, 2000),
    stack: String(error?.stack || '').slice(0, 6000)
  });
});
