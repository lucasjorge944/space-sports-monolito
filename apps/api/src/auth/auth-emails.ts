import type { MailMessage } from '../mail/mailer.js';

type EmailInput = { to: string; name: string; url: string };

/** E-mail de confirmação do endereço (enviado no cadastro). */
export function verificationEmail({ to, name, url }: EmailInput): MailMessage {
  return renderEmail(to, 'Confirme seu e-mail', name, {
    intro: 'Confirme seu e-mail para concluir o cadastro no Space Sports.',
    action: 'Confirmar e-mail',
    url,
    outro: 'Se você não criou uma conta, ignore este e-mail.',
  });
}

/** E-mail de redefinição de senha ("esqueci a senha"). */
export function resetPasswordEmail({ to, name, url }: EmailInput): MailMessage {
  return renderEmail(to, 'Redefinir sua senha', name, {
    intro: 'Recebemos um pedido para redefinir a senha da sua conta no Space Sports.',
    action: 'Redefinir senha',
    url,
    outro:
      'O link expira em 1 hora. Se não foi você, ignore este e-mail: sua senha continua a mesma.',
  });
}

/** E-mail de boas-vindas (RF-NOTIF-02), enviado quando o e-mail da conta fica verificado. */
export function welcomeEmail({ to, name }: Omit<EmailInput, 'url'>): MailMessage {
  return renderEmail(to, 'Bem-vindo ao Space Sports', name, {
    intro:
      'Sua conta está pronta. Encontre quadras perto de você, reserve o horário e chame a galera para dividir a conta pelo app.',
    outro: 'Bom jogo!',
  });
}

/** Layout dos e-mails transacionais (texto + HTML), reaproveitado pelos convites de equipe. */
export function renderEmail(
  to: string,
  subject: string,
  name: string,
  body: { intro: string; action?: string; url?: string; outro: string },
): MailMessage {
  const greeting = name.trim() ? `Olá, ${name.trim()}!` : 'Olá!';
  const { action, url } = body;
  const text = [
    greeting,
    '',
    body.intro,
    ...(action && url ? ['', `${action}: ${url}`] : []),
    '',
    body.outro,
  ].join('\n');
  const html = `<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(body.intro)}</p>
${action && url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>\n` : ''}<p>${escapeHtml(body.outro)}</p>`;
  return { to, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
