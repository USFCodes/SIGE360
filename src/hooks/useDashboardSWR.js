'use client';

import useSWR from 'swr';

const dashboardSWRConfig = {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false
};

export default function useDashboardSWR(key, fetcher, options = {}) {
    return useSWR(key, fetcher, { ...dashboardSWRConfig, ...options });
}
