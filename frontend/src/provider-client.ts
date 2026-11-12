export type ProviderView = {
  enabled: boolean;
  endpoint: string;
  model: string;
  hasKey: boolean;
  warning?: string;
};
type ExplainInput = { scene: string; look: string; preset_id: string };
type Cancellable<T> = Promise<T> & {
  cancelOn: (signal: AbortSignal) => Promise<T>;
};
type Runtime = {
  Call: { ByName: <T>(name: string, ...args: unknown[]) => Cancellable<T> };
};

function runtime(): Promise<Runtime> {
  const url = "/wails/runtime.js";
  return import(/* @vite-ignore */ url);
}

export async function providerSettings(
  method: "GetSettings" | "SaveSettings" | "ForgetKey",
  ...args: unknown[]
) {
  return (await runtime()).Call.ByName<ProviderView>(
    `main.ProviderService.${method}`,
    ...args,
  );
}

export async function requestExplanation(
  input: ExplainInput,
  signal: AbortSignal,
) {
  const bridge = await runtime();
  signal.throwIfAborted();
  return bridge.Call.ByName<string>(
    "main.ProviderService.Explain",
    input,
  ).cancelOn(signal);
}
