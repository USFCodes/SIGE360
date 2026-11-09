export function chaveLeituraNotificacoes(escolaId, utilizadorId) {
  return escolaId && utilizadorId
    ? `sige360:notificacoes-vistas:${escolaId}:${utilizadorId}`
    : '';
}

export function temNotificacoesNovas(notificacoes, chave) {
  if (!chave || typeof window === 'undefined') return false;
  let ultimaVista;
  try {
    ultimaVista = window.localStorage.getItem(chave);
  } catch (error) {
    console.error('Não foi possível consultar a última visualização das notificações:', error);
    return notificacoes.length > 0;
  }
  if (!ultimaVista) return notificacoes.length > 0;

  const timestampVista = Date.parse(ultimaVista);
  if (Number.isNaN(timestampVista)) return notificacoes.length > 0;
  return notificacoes.some((item) => {
    const timestamp = Date.parse(item.data_hora || '');
    return !Number.isNaN(timestamp) && timestamp > timestampVista;
  });
}

export function marcarNotificacoesVistas(chave) {
  if (!chave || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chave, new Date().toISOString());
  } catch (error) {
    console.error('Não foi possível guardar a última visualização das notificações:', error);
  }
  window.dispatchEvent(new Event('sige360:notificacoes-atualizadas'));
}
