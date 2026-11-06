# Lições de revisão · web-engineer

Promovidas automaticamente pelo `dispatch.py` quando o code-reviewer aponta o mesmo padrão em tarefas diferentes. Entram no prompt do agente a cada lançamento. Edite à vontade: junte, reescreva ou apague as que perderem o sentido.

- Nos mocks do e2e, derive campos de regra (vitrine, elegível, conta na média) das mesmas condições do service da API e respeite os invariantes do contrato (ex.: showcase.visible falso só com missing não vazio); ao estender um mock simplificado, corrija a regra em vez de escrever o spec sobre ela, porque o teste passa num estado que a API nunca produz e o caminho real fica sem cobertura. _(revisões: AV.6b, AV2.2)_ <!-- key: mock-mirrors-service-conditions -->
