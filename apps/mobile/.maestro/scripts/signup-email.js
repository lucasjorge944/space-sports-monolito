// E-mail único por execução para o cadastro (o seed não precisa ser refeito entre as rodadas).
// O runScript do Maestro (GraalJS) aceita template literal.
output.SIGNUP_EMAIL = `cadastro.${Date.now()}@exemplo.com`;
