# Space Sports
Vamos desenvolver um plano para desenvolvimento de um produto novo. Documente todo o plano para execução posteriormente.

## Sobre o produto

O produto será uma plataforma para pessoas encontrarem espaços de esportes perto da sua localização. Incialmente será focado em quadras de areia na localização de Belo Horizonte Minas Gerais, podendo expadir para outros esportes e localidades. Usuários poderão se cadastrar em um aplicativo mobile, ver e procurar espaços perto da sua localização, e cada espaço oferecerá serviços para esses usuários, como, aluguel do espaço, aulas e torneios.

## Serviços

### Aluguel do espaço

Os espaços oferecerão a possiblidade de alugar o espaço por hora.
1 hora -> R$ 100,00
2 horas -> R$ 200,00
3 horas -> R$ 300,00

Um espaço pode ter várias quadras disponíveis para aluguel.
Quando um usuário desejar alugar um espaço ele deve informar:
- Esporte desejado: Futvolei, Beach-Tenis, Volei, etc...
- Número de pessoas
- Quantidade de horas
- Forma de pagamento
- Data/Hora

### Aulas

Os espaços terão a possibilidade de cadastrar e oferecer planos de aulas para os esportes, onde os alunos poderão:
- Se cadastrar em planos de aulas disponíveis, exemplo: 1x na semana futvolei, 2x na semana futvolei, Ilimitado na semana futvolei, 1x na semana beach tenis, etc... 
- Confirmar presenção em aulas disponíveis para aquele aluno no dia de acordo com o plano.
- Ver informações da aula disponível para a semana e o dia: Lista de presença, dia/hora, etc...
- Fazer o controle do plano, contratar, cancelar, pausar
- Fazer controle dos meios de pagamento

Uma aula tem um número máximo de alunos.
Um espaço terá professores cadastrados e pre definidor para as aulas.
A lista de presença de uma aula deve ser aberta e fechada por um Admin ou Professor.


### Torneios

Um espaço poderá realizar eventos de torneios dos esportes. Onde toda gestão será controlada na plataforma.
Definir o esporte do torneio, sobre o torneio, as inscrições, o modelo do torneio, o chaveamento, o sorteio de partidas, etc...

## Aplicações

### Aplicativo Mobile

Será um aplicativo que ficará nas Stores.
Terá um modelo de rolagem de vitrine das quadras como referẽncia o Instagram, Wellhub/Gympass.
Dentro de cada espaço terá todas as informações pertinentes:
- Serviçios oferecidos
- Fotos
- Infraestrutura do espaço: Banheiros, Bar, Estacionamento
- Localização
etc...

#### Usuarios Alunos

Pode ver espaços e contratar serviços.

#### Usuarios da parte de Gestão da quadra

Podem tanto contratar serviços como acompanhar as informações dos serviços daquele espaço que ele pertence.


### Aplicação Web

Essa aplicação será a parte administrativa do espaço, onde os Admins e Professores poderão realizar toda a parte de configuração dos serviços e informações do espaço. A gestão toda acontece aqui.
Alunos e usuários que não são de parte administrativa de um espaço não terão acesso a essa parte.


## Arquitetura

Me recomende a melhor arquitetura e frameworks para o aplicativo mobile, web, front-end, back-end, etc e vamos criar e refinar um plano de progresso para criação desse produto.
Para design me recomende libs prontas que agilizem o processo de criação de elementos para as telas.


Caso tenha dúvidas sobre o briefing do produto me pergunte, e me recomende melhorias e ajustes para o produto ficar melhor.