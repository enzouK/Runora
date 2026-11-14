package com.runora.fsrs;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Runora — Activity principal ( Capacitor ).
 *
 * Única diferença em relação ao padrão do Capacitor: o login do Google.
 *
 * No Android o popup do Google Identity Services não funciona (o WebView não
 * tem `window.opener` de verdade e o Capacitor manda qualquer URL externa para
 * o Chrome, onde o token se perde). Então o app usa o fluxo OAuth manual:
 *
 *   1. `DriveSyncService` monta a URL de autorização e chama
 *      `RunoraAuth.loadAuthUrl(url)` (esta classe) — a página do Google abre
 *      DENTRO do app.
 *   2. O Google redireciona para `https://localhost/?code=...` — a mesma
 *      origem que o Capacitor usa para servir o app.
 *   3. Esta classe deixa essa navegação acontecer (em vez de mandá-la para o
 *      Chrome) e guarda o `code` no localStorage, como backup.
 *   4. O app (que recarrega nesse redirect) retoma a troca do código por
 *      token em `DriveSyncService.completePendingLogin()`.
 */
public class MainActivity extends BridgeActivity {

    /** Origem em que o Capacitor serve o app (e na qual o OAuth volta). */
    private static final String APP_ORIGIN = "https://localhost";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final Bridge bridge = getBridge();
        final WebView mainWebView = bridge.getWebView();

        // Interface JS para carregar a URL de autorização do Google direto no
        // WebView principal (o app chama isso em vez de `location.href`).
        mainWebView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void loadAuthUrl(String url) {
                runOnUiThread(() -> mainWebView.loadUrl(url));
            }
        }, "RunoraAuth");

        // IMPORTANTE: estende BridgeWebViewClient (e NÃO WebViewClient) para
        // manter o servidor local de assets do Capacitor. Com um WebViewClient
        // puro o app nem carrega (ERR_CONNECTION_REFUSED em https://localhost).
        mainWebView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    android.util.Log.d("RunoraLogin", "shouldOverrideUrlLoading: " + url);

                    // O callback do OAuth volta para a origem do app: fica no WebView.
                    if (url.startsWith(APP_ORIGIN)) {
                        return false;
                    }

                    // O login do Google precisa rodar DENTRO do app (se for para o
                    // Chrome, o callback volta para fora e o token se perde).
                    if (isGoogleAuthHost(request.getUrl().getHost())) {
                        return false;
                    }

                    // Qualquer outra URL: comportamento padrão do Capacitor
                    // (abre no navegador externo, respeitando allowNavigation).
                    return super.shouldOverrideUrlLoading(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    android.util.Log.d("RunoraLogin", "onPageFinished: " + url);

                    // Redirect do OAuth: https://localhost/?code=...&state=...
                    // O app já lê o code direto da URL quando recarrega por aqui
                    // (DriveSyncService.completePendingLogin) — não guardamos nada
                    // no localStorage para não deixar um code "velho" pendente.
                }
            }
        );
    }

    /**
     * Hosts do Google usados no login (ficam dentro do app).
     *
     * IMPORTANTE (bug de 14/11/2026, no celular real): o login do Google usa
     * MAIS domínios do que só o `accounts.google.com`. Num aparelho que já
     * tem conta Google configurada, o Google passa o cookie da sessão por
     * `accounts.youtube.com/accounts/SetSID` — e esse host não estava na
     * lista: a navegação saía do app e ia para o Chrome, onde o token se
     * perde (no emulador não acontecia, porque ele não tem conta Google).
     *
     * A lista abaixo cobre todos os domínios do Google que o login toca.
     */
    private static boolean isGoogleAuthHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(java.util.Locale.US);

        // Contas e consentimento (inclui os domínios regionais).
        if (h.startsWith("accounts.google.")) return true;
        if (h.startsWith("consent.google.")) return true;
        if (h.startsWith("accounts.youtube.")) return true;
        if (h.startsWith("myaccount.google.")) return true;

        // APIs e arquivos do Google (o login carrega scripts/CSS deles).
        if (h.equals("googleapis.com")) return true;
        if (h.endsWith(".googleapis.com")) return true;
        if (h.equals("gstatic.com")) return true;
        if (h.endsWith(".gstatic.com")) return true;
        if (h.endsWith(".googleusercontent.com")) return true;

        // Qualquer outro domínio do Google (ex.: accounts.google.co.uk).
        return h.matches("^(.*\\.)?google\\.[a-z]{2,3}(\\.[a-z]{2})?$");
    }
}
