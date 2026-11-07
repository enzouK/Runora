import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Modo desenvolvimento: se CAP_SERVER_URL estiver definido, o app carrega
 * o Runora direto do servidor Vite (em vez dos arquivos empacotados).
 * Assim o celular/emulador roda SEMPRE a mesma versão que o servidor.
 *
 * Exemplo (emulador Android, o 10.0.2.2 é o "localhost" do PC):
 *   $env:CAP_SERVER_URL='http://10.0.2.2:3000'
 *   npx cap copy android
 *
 * Sem a variável (build de produção), o app usa os arquivos de `dist`.
 */
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.runora.fsrs',
  appName: 'Runora',
  webDir: 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: true,
          androidScheme: 'http',
        },
      }
    : {}),
};

export default config;
