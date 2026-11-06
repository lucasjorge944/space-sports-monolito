import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * A escala da marca (`text-h3`, `text-overline`…, docs/05-design-system.md) é tamanho de fonte. Sem isto o
 * tailwind-merge a toma por cor e descarta `text-h3` ao lado de `text-muted-foreground`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'small', 'helper', 'overline'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Anel de foco da marca (docs/05-design-system.md): Sol, com a faixa `ring-offset` que o deixa visível nos dois temas. */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ring-offset';

/** Link de texto (pranchas 04, 06 e 07): Mar no claro, Mar 200 no escuro; `link-hover` ao passar o mouse. */
export const textLink = 'text-link underline-offset-4 hover:text-link-hover hover:underline';

/** Rótulo de seção e de número (overline do kit): Inter 12/16, 600, caixa alta, texto secundário. */
export const overline = 'font-sans text-overline uppercase text-muted-foreground';

/**
 * Campo de formulário (prancha 06; 07 no escuro): borda 1.5 `input` sobre `input-background`; em foco, borda
 * `input-focus` e fundo `input-focus-background` (Sol 50 no claro) com o anel Sol; em erro, borda e fundo
 * `input-error`, inclusive em foco (o par com `focus-visible` impede o foco de cobrir o erro); desabilitado em `input-disabled`, com o placeholder no mesmo tom do texto
 * (mais forte que ele, chamaria mais atenção que o valor). Altura e padding ficam com cada campo.
 */
export const fieldClasses = cn(
  'w-full min-w-0 rounded-md border-[1.5px] border-input bg-input-background text-base transition-[color,background-color,border-color,box-shadow] md:text-sm',
  focusRing,
  'focus-visible:border-input-focus focus-visible:bg-input-focus-background',
  'aria-invalid:border-input-error aria-invalid:bg-input-error-background aria-invalid:focus-visible:border-input-error aria-invalid:focus-visible:bg-input-error-background',
  'disabled:cursor-not-allowed disabled:border-disabled disabled:bg-input-disabled disabled:text-disabled-foreground disabled:placeholder:text-disabled-foreground',
);

/** Ao enviar com erro, o foco vai para o primeiro campo inválido; o erro só entra no próximo quadro. */
export function focusFirstInvalid(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    form
      .querySelector<HTMLElement>(
        ':is(input, textarea, select, button)[aria-invalid="true"], [role="group"][aria-invalid="true"] button',
      )
      ?.focus();
  });
}
