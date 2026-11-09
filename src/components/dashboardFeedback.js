export default function DashboardFeedback({
    dashboard,
    error,
    isLoading,
    isValidating,
    onRetry,
    loadingMessage = 'A carregar dados do dashboard...'
}) {
    return (
        <>
            {error && (
                <div className="dashboard-error" role="alert">
                    <span>{error.message || 'Não foi possível carregar os dados do dashboard.'}</span>
                    {onRetry && (
                        <button type="button" onClick={onRetry} disabled={isValidating}>
                            Tentar novamente
                        </button>
                    )}
                </div>
            )}
            {isLoading && !dashboard && (
                <div className="dashboard-state" role="status">{loadingMessage}</div>
            )}
        </>
    );
}
