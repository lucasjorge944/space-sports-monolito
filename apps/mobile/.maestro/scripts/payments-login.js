// Login por e-mail e senha na API (Better Auth, `POST /v1/auth/sign-in/email`): devolve o token
// de sessão em `output.API_TOKEN` para os scripts do pagamento online. Env: API_URL, LOGIN_EMAIL,
// LOGIN_PASSWORD. O app usa o mesmo token como `Authorization: Bearer`.
var response = http.post(`${API_URL}/v1/auth/sign-in/email`, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
});
if (response.status >= 400) throw new Error(`Login falhou (${response.status}): ${response.body}`);
output.API_TOKEN = json(response.body).token;
