interface ContentAreaProps {
  appName?: string;
  appVersion?: string;
}

export function ContentArea({ appName, appVersion }: ContentAreaProps) {
  return (
    <main className="flex flex-1 items-center justify-center bg-white dark:bg-neutral-800">
      {appName && appVersion ? (
        <p className="text-neutral-600 dark:text-neutral-300" data-testid="app-info">
          {appName} v{appVersion}
        </p>
      ) : (
        <p className="text-neutral-400">Loading...</p>
      )}
    </main>
  );
}
