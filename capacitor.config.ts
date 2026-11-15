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
 *
 * No modo dev o app vira OUTRO pacote (`com.runora.fsrs.dev`, com o nome
 * "Runora Dev"), com dados totalmente separados do de produção
 * (`com.runora.fsrs`): cada um tem o seu diretório de dados, o seu
 * deviceId e o seu login.
 *
 * Onde cada APK fica instalado (regra do dono em 15/11/2026):
 *   - celular real -> só o app de PRODUÇÃO (`com.runora.fsrs`);
 *   - emulador     -> só o app de DEV (`com.runora.fsrs.dev`).
 *
 * O `applicationId` do Gradle acompanha essa mudança (ver
 * `android/app/build.gradle`, opção `-PdevBuild=true`).
 */
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: serverUrl ? 'com.runora.fsrs.dev' : 'com.runora.fsrs',
  appName: serverUrl ? 'Runora Dev' : 'Runora',
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
