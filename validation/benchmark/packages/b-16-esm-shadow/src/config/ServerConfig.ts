export interface ServerConfig {
  port: number;
  assetsPath: string;
  uploadsPath: string;
}

export function loadConfig(assetsPath: string, uploadsPath: string): ServerConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    assetsPath,
    uploadsPath,
  };
}
