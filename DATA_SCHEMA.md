# DATA_SCHEMA

## Projeto PP
Arquivo: `OPIT-PP*PROJETO COMPLETO*`

Campos principais:
- `Number` integer
- `UTM_X` float
- `UTM_Y` float
- `Length_m` float
- `Stemming_m` float
- `Diameter_mm` float
- `Subdrilling_m` float
- `Angle_deg` float
- `Azimuth_deg` float
- `Total_Charge_kg` float

## Realizado PP
Arquivo: `OPIT-PP*CONFIG FINAL*`

Campos principais:
- `Number` integer
- `X` float
- `Y` float
- `Z` float
- `X_Toe` float
- `Y_Toe` float
- `Z_Toe` float
- `Length` float
- `Stemming` float
- `Diameter` float
- `Subdrilling` float
- `Angle` float
- `Azimuth` float
- `DetonatingTime` float na entrada; vazio, não numérico, negativo (inclusive `-1`) e repetição posterior são tratados como ausência. Na saída, é inteiro, não negativo e único por furo, preenchido por sequência determinística baseada na ordem de `Number` e nas âncoras vizinhas.
- `InputedCharge` float
- `eliminated` integer, optional

## Simulação de teste
- `tampao previsto` e `tampao realizado` são exportados com uma casa decimal.
- `tampao realizado` pode receber variação determinística de até `0,12` para mais ou para menos quando habilitado na configuração.

## Redistribuição de carga zerada
- Quando existirem furos com `InputedCharge == 0`, a redistribuição deve usar `business.charge_total_target_kg` e `business.charge_zero_fill_min_kg`.
- Os furos com menor e maior carga não podem ser alterados.
- O total final da coluna deve permanecer idêntico ao total alvo configurado.

## Fechamento do total de carga
- Quando `business.enforce_charge_total_target: true`, o sistema deve ajustar `cargas realizadas` para fechar exatamente em `business.charge_total_target_kg` mesmo sem cargas zeradas.
- O ajuste só pode atuar nos furos intermediários.
- O menor e o maior valor de carga devem permanecer inalterados.
- Nenhum valor ajustado pode ficar abaixo do menor valor preservado nem acima do maior valor preservado.

## Historico de disparo
Arquivo: `HISTO-*.txt`

Campos/eventos usados:
- `[BlastingPlan]YYYY/MM/DD-HH:MM:SS` abre o bloco operacional carregado no detonador.
- Linhas `PU...;PP<plano>;...` identificam o plano dentro do bloco, por exemplo `PP320526`.
- `[Fire]YYYY/MM/DD-HH:MM:SS` define a data e hora do disparo somente quando vem depois do `[BlastingPlan]` que contém o plano correto.
- Numeros encontrados em listas de detonadores, testes ou falhas nao sao IDs de plano.

## Saída Excel
Abas:
- `Dados dos Furos`
- `Resumo`

Colunas principais em `Dados dos Furos`:
- `Data`, `Horario`, `Plano`, `Tipo`, `id`, `y`, `x`, `Z (crest)`, `Z (toe)`, `profundidade prevista`, `profundidade realizada`, `azimute`, `inclinacao`, `cargas previstas`, `cargas realizadas`, `tampao previsto`, `tampao realizado`, `subfuracao`, `diametro`, `tempo detonacao (ms)`

## Metadados de identificação
IDs de plano podem aparecer como `PP370626`, `PP0370626` ou com separadores. A composição é `PLANO;MÊS;ANO`: os quatro últimos dígitos são mês e ano, e o trecho anterior é o plano. Para comparação, o prefixo e os separadores são removidos, zeros à esquerda do plano são ignorados, o ano deve ser igual e o mês é ignorado para permitir detonação em mês posterior ou anterior ao mês de emissão. A forma encontrada no HISTO é mantida como o ID do evento na saída. Se houver múltiplos blocos compatíveis, o mês coincidente tem prioridade; sem desempate único, a validação falha por ambiguidade.
