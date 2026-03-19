export interface PluginConfig {
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  maxRetries: number;
  timeoutMs: number;
  featureFlags: Record<string, boolean>;
}

const DEFAULT_CONFIG: PluginConfig = {
  logLevel: 'warn',
  maxRetries: 3,
  timeoutMs: 5000,
  featureFlags: {},
};

/**
 * Loads plugin configuration from the environment or a config file.
 * Config can be updated at runtime (e.g. from a remote config service).
 */
export class ConfigLoader {
  private currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

  getConfig(): PluginConfig {
    return this.currentConfig;
  }

  updateConfig(partial: Partial<PluginConfig>): void {
    this.currentConfig = { ...this.currentConfig, ...partial };
    console.info('[ConfigLoader] Config updated:', partial);
  }

  setFeatureFlag(flag: string, enabled: boolean): void {
    this.currentConfig = {
      ...this.currentConfig,
      featureFlags: { ...this.currentConfig.featureFlags, [flag]: enabled },
    };
  }

  reset(): void {
    this.currentConfig = { ...DEFAULT_CONFIG };
  }
}
