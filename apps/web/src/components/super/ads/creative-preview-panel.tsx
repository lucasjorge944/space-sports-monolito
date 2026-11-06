'use client';

import type { AdPlacement } from '@space-sports/shared';
import { useState } from 'react';
import { ChipButton } from '@/components/ui/chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  FeedPreview,
  HeroPreview,
  type PreviewContent,
  PreviewFrame,
  sponsoredName,
} from './ad-preview';

const SCREEN_WIDTHS = [320, 360, 412] as const;
/** Margem lateral do app (16 de cada lado). */
const SCREEN_PADDING = 32;

/**
 * Prévia da peça nos temas claro e escuro (docs/05, "Pré-visualização no /super"): lado a lado a
 * partir de ~1600 px de janela; abaixo disso, abas Claro | Escuro com uma moldura por vez. O seletor
 * de largura (320 · 360 · 412) mostra quando o texto do banner sai.
 */
export function CreativePreviewPanel({
  placement,
  content,
  segments,
}: {
  placement: AdPlacement;
  content: PreviewContent;
  segments: number;
}) {
  const wide = useMediaQuery('(min-width: 1600px)');
  const [screen, setScreen] = useState<(typeof SCREEN_WIDTHS)[number]>(360);
  const width = screen - SCREEN_PADDING;

  const sponsor = sponsoredName(content);
  const piece =
    placement === 'EXPLORE_HERO' ? (
      <HeroPreview content={content} width={width} segments={segments} />
    ) : (
      <FeedPreview content={content} width={width} />
    );

  return (
    <div className="flex flex-col gap-4" data-testid="creative-preview">
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="text-muted-foreground float-left mr-1 text-sm">Largura da tela:</legend>
        {SCREEN_WIDTHS.map((value) => (
          <ChipButton key={value} selected={screen === value} onClick={() => setScreen(value)}>
            {value} dp
          </ChipButton>
        ))}
      </fieldset>
      {wide ? (
        <div className="flex flex-wrap gap-6">
          <PreviewFrame theme="light" screenWidth={screen} sponsor={sponsor}>
            {piece}
          </PreviewFrame>
          <PreviewFrame theme="dark" screenWidth={screen} sponsor={sponsor}>
            {piece}
          </PreviewFrame>
        </div>
      ) : (
        <Tabs defaultValue="light">
          <TabsList aria-label="Tema da pré-visualização">
            <TabsTrigger value="light">Claro</TabsTrigger>
            <TabsTrigger value="dark">Escuro</TabsTrigger>
          </TabsList>
          <TabsContent value="light" className="overflow-x-auto">
            <PreviewFrame theme="light" screenWidth={screen} sponsor={sponsor}>
              {piece}
            </PreviewFrame>
          </TabsContent>
          <TabsContent value="dark" className="overflow-x-auto">
            <PreviewFrame theme="dark" screenWidth={screen} sponsor={sponsor}>
              {piece}
            </PreviewFrame>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
