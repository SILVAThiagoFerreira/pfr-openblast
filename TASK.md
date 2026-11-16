# TASK

Reestruturar o gerador de plano de fogo em uma base modular, configurável e validada, preservando a capacidade de processar o layout PP atual e produzir o Excel final com rastreabilidade.

Regras operacionais atuais:
- O plano operacional pode ser fixado em `business.fallback_plan_id` quando a extracao automatica puder capturar IDs de detonadores ou eventos de teste.
- Se o PDF e o HISTO representarem o mesmo plano com e sem zero à esquerda, o sistema deve tratar as duas formas como equivalentes para resolver o bloco correto e o nome da saida.
- IDs devem ser interpretados como `PLANO;MÊS;ANO`: o mesmo plano e ano devem localizar o bloco correto mesmo quando o mês do PDF/arquivos for diferente do mês da detonação; o mês não deve ser usado como igualdade estrita.
- Se houver mais de um bloco do mesmo plano e ano, priorizar o mês coincidente; sem candidato único, falhar explicitamente por ambiguidade.
- A data/hora do disparo deve ser o primeiro `[Fire]` posterior ao `[BlastingPlan]` que contem o plano correto, nunca o ultimo `[Fire]` do arquivo inteiro.
- `DetonatingTime` vazio, não numérico, negativo (inclusive `-1`) ou repetido é tratado como ausência. A sequência ordenada por `Number` e os tempos válidos dos furos vizinhos determinam os tempos simulados.
- `DetonatingTime` imputado é arredondado para inteiro, sem casas decimais, e a saída nunca pode conter dois furos com a mesma temporização.
- Valores originais de tampão não são alterados automaticamente; padrões repetitivos devem ser tratados como sinal de validação, não com randomização.
- Em modo de teste, `tampao realizado` pode receber variação determinística de até `0,12` para mais ou para menos e `tampao previsto` / `tampao realizado` devem ser exportados com uma casa decimal.
- Quando houver furos com `InputedCharge` zerado, a carga deve ser redistribuída com total alvo configurado, preservando o menor e o maior valor da coluna.
- Quando `business.enforce_charge_total_target` estiver habilitado, a carga total aplicada deve fechar no alvo configurado mesmo sem furos zerados, preservando o menor e o maior valor da coluna.
- O `Config Final` é a fonte autoritativa dos furos realizados: IDs presentes nele devem permanecer na saída mesmo que o `Projeto Completo` marque esses registros como `eliminated`. `business.include_eliminated` controla a exceção explícita, a cardinalidade deve ser validada e as contagens ficam no log.
- A aba `Resumo` do Excel contém somente as colunas `Plano`, `Data` e `Hora`, com uma linha de valores.
- A publicação no GitHub Pages deve operar sem inteligência artificial, chave de API ou serviço pago; o modo público processa os anexos localmente no navegador.
- O site deve oferecer um bloco opcional para informar o total de carga realizada em kg, a carga mínima por furo e o ID do furo que receberá o mínimo; quando habilitado, deve distribuir a diferença em todo o plano, fixar esse mínimo no ID informado, preservar exatamente todos os furos empatados na maior carga original da planilha e fechar o total informado, validando combinações inviáveis e o conflito de um ID mínimo que já seja máximo.
- A interface pública deve identificar as tabelas pelas colunas, validar a assinatura do PDF, rejeitar anexos duplicados/excessivos e gerar log local quando a validação falhar.
- A interface pública deve orientar os cinco arquivos: Config Final.csv, Projeto Completo.csv, Historial da BMO, Plano de Perfuração.xlsx e Plano de Perfuração.pdf; no modo forçado, o Historial da BMO pode ser omitido.
- O histórico da BMO deve aceitar o padrão `*_histo.log`, com blocos `[StartProcedure]`, linhas `BP:` e eventos `[Fire]`.
- O site deve importar um arquivo `.brex` do BMO pelo botão "Importar BREX (BMO)", listar os disparos com ajuste de horário em horas (padrão `business.brex_offset_hours`) aplicado ao vivo e preencher a data e o horário de desmonte com o disparo escolhido (HH:MM:SS), mantendo ambos editáveis e respeitando edições manuais quando o ajuste muda. Os disparos que combinam com o ID informado ficam em destaque e primeiro na lista.
- O site deve oferecer conversão de fuso no processamento, com `UTC-03:00` como opção padrão e o resultado registrado no Excel.
- O site deve disponibilizar exatamente os três modelos oficiais para download, preservando os nomes originais: “Plano de Fogo - PC.xls” (Modelo - Pré-Corte - SEM FUROS), “Plano de Fogo Realizado - PP.xlsx” (Modelo - Produção) e “Plano Realizado - REG .xls” (Modelo - Regularização).

Critério objetivo de conclusão:
- o projeto possui documentação completa;
- a configuração centraliza caminhos e parâmetros;
- o fluxo executa por um único entrypoint;
- as etapas de leitura, validação, processamento e exportação estão separadas.

## Atualização: cota (Z) do realizado
Motivo: o Z de saída do export de 27/10/2026 (REG CRISTA F3) estava na escala de X (748775,62 no furo 171), não em cota (~287,63 m). O Excel de referência exige cota.

Ordem aplicada (AGENTS.md): especificação (SPEC, PIPELINE, DATA_SCHEMA), configuração (`config.yaml` e `public/config.js`), módulo de cota (`public/elevation.js` e `src/pfr/elevation.py`), leitura e validação do plano de perfuração (`public/app.js`, `src/pfr/io.py`, `src/pfr/validation.py`, `src/pfr/discovery.py`), processamento e testes.

- Z do Config Final só é usado como cota dentro da faixa configurada; caso contrário, Z (crest) vem do Plano de Perfuração (Z Collar) com X/Y conferidos.
- Z (toe) do Config Final ou calculado pela geometria realizada, com aviso.
- Furos sem cota ficam em branco com aviso (sem erro silencioso); sem cota em nenhum furo, a execução NÃO para: gera o Excel com Z em branco e o aviso "Nenhum furo com cota; Z em branco" (site e log da CLI).
- Planilha de plano sem `Z Collar` (ou demais colunas de cota) não bloqueia: aviso e cota não lida dela.
- Configuração nova: `business.elevation_*`, `inputs.pp.design_patterns`, `validation.required_design_columns`.
- Testes: `tests/test_elevation.js`, `tests/test_elevation.py`, `tests/test_frontend.js` (routing e docs/) e `tests/test_browser_config.py` (espelho das chaves).
- Decisão do usuário: quando faltar a cota, traga sem a cota (nunca bloquear). Cinco furos do Config Final (1000, 1001, 1002, 1004 e 1006) não existem no Plano de Perfuração do cenário e ficam sem Z, com aviso.
- Testes: `tests/test_elevation.js` e `tests/test_elevation.py` (nenhum furo com cota: Z em branco + aviso, sem erro).

## Atualização do modo online
- Permitir inclusão e remoção incremental de anexos sem reiniciar a seleção.
- Manter uma área operacional compacta, com tutorial, opções avançadas e modelos recolhíveis, sem remover os controles funcionais nem as orientações essenciais.
- Ao iniciar a geração sem anexos, informar o estado vazio e orientar o usuário a anexar os arquivos do plano.
- Reconhecer variações do ID do plano no HISTO, no nome do arquivo e nas tabelas, incluindo zeros à esquerda, separadores e meses diferentes para o mesmo plano/ano, com bloqueio de ambiguidades.
- Disponibilizar o campo `ID / nome do plano de fogo em trabalho` para identificação manual e o botão confirmado `Forçar execução` para divergências explicáveis pelo mês de emissão/desmonte ou ausência do HISTO, preservando as demais validações.
- Quando o HISTO não for anexado, exigir a data e o horário locais informados no site; não usar a data do computador como fallback. Manter as fontes do evento visíveis no resultado da página.
- Registrar no Excel e no log o ID efetivamente encontrado no HISTO quando houver diferença.
- Quando o bloco de carga-alvo estiver habilitado, registrar no Excel o total aplicado, a carga mínima, o ID do furo de menor carga, a maior carga preservada e o ID do furo de maior carga.
- Ao anexar os dados no site, sugerir automaticamente a menor carga positiva de `InputedCharge` e o primeiro ID correspondente para os campos de carga mínima e ID mínimo, sem sobrescrever edições manuais.

## Atualização: identificação textual e avisos não bloqueantes (site)
Motivo: um ID de plano textual (ex.: `REG CRISTA F3`) era descartado e a execução falhava com "Informe o ID numérico do plano", mesmo com os dados válidos. Objetivo: bloquear somente o que compromete os dados; o que é trivial vira aviso visível.

Ordem de implementação aplicada (AGENTS.md): configuração (`config.yaml` e `public/config.js`), depois validação e resolução (`public/plan-label.js`, `public/table-headers.js`, `public/plan-id.js`), depois processamento (`public/app.js`), testes e documentação.

- ID digitado, textual ou numérico, é o ID do plano. Sem ID digitado, usa-se o ID dos anexos/HISTO, depois o nome do PDF/planilha derivado (com aviso), depois um ID gerado `PFR_<data>_<horário>` (com aviso).
- Nome de arquivo sanitizado para ID textual; ID numérico mantém `Plano_Fogo_Realizado_PP<plano>.xlsx`.
- Cabeçalhos das colunas obrigatórias reconhecidos sem diferenciar caixa, acentos e espaços (aviso por ajuste).
- Arquivo `.brex` no campo principal de anexos é encaminhado ao importador do BREX e não é mais tratado como anexo.
- Mantido como erro (dados e regras de segurança): ausência de HISTO no modo automático, data/horário ausentes no modo forçado, HISTO sem nenhum bloco de plano para escolher o disparo, ID do HISTO diferente dos anexos sem forçar, anexos de planos diferentes, ambiguidade de blocos, colunas obrigatórias ausentes, e toda validação de furos, cargas e temporização.
- Configuração nova: `business.plan_label_fallback_prefix`, `business.plan_label_max_length`, `business.plan_label_generic_names`, `business.output_name_text_template`. Espelho em `public/config.js`, verificado por `tests/test_browser_config.py`.
- Testes: `tests/test_plan_label.js`, `tests/test_table_headers.js`, `tests/test_plan_id.js` (ID vazio sem bloqueio), `tests/test_frontend.js` (routing do BREX e espelho `docs/`).
- Pendência aberta: no modo automático sem HISTO, a regra do SPEC continua bloqueando. Decisão do usuário se deve passar a aceitar data e horário informados.

Ao escolher ou arrastar um BREX junto aos demais arquivos, o navegador o lê automaticamente. Se houver um único disparo, a data e o horário locais preenchem os campos vazios; valores já informados são preservados. Com mais de um disparo, o usuário escolhe o evento na lista. A escolha manual permanece disponível e pode substituir os valores.

## Atualização: furo de assinatura
Motivo: o furo de assinatura não pode ter carga e tampão alterados por regras de ajuste de valor (redistribuição, carga-alvo e variação de tampão). Ele não fica isento de conversões e formatações.

Correção do usuário (segunda rodada): "preservado" significa não alterar valores por regras de ajuste, como aumentar ou diminuir a carga e variar o tampão. Não significa preservar o formato. O diâmetro sai convertido para polegadas (5, não 0,127); a cota, as unidades, os arredondamentos e as colunas seguem a regra normal. Só ficam de fora os ajustes de valor. O tempo segue o mesmo tratamento dos demais, sem imputação, porque imputar altera um valor.

Ordem aplicada (AGENTS.md): especificação (SPEC, PIPELINE, DATA_SCHEMA), configuração (`business.signature_hole_id` em `config.yaml` e `public/config.js`), validação (`src/pfr/validation.py`, `public/signature-hole.js`), processamento (`src/pfr/processing.py`, `src/pfr/elevation.py`, `public/charge.js`, `public/stemming.js`, `public/elevation.js`, `public/app.js`), interface (`public/index.html`, `public/force-execution.css`), testes e documentação. O `docs/` espelha `public/`.

- Checkbox "Plano teve furo de assinatura?" e campo de ID com lista dos furos do Config Final (aceita digitação), no bloco "Opções de saída".
- ID inválido, ausente ou repetido, e tempo que não pode ser usado sem imputação (vazio, negativo ou repetido de um furo anterior), bloqueiam com mensagem explícita.
- Carga e tampão do furo: fora da redistribuição de zeros, do alvo de carga, do fechamento de total e da variação. Conversões, arredondamentos, tempo e cota: regra normal.
- Sem o checkbox marcado (ou com `signature_hole_id` vazio), o comportamento é idêntico ao anterior.
- Testes: `tests/test_signature_hole.py` (inclui execução completa da CLI e diâmetro em polegadas), `tests/test_signature_hole.js`, `tests/test_browser_config.py`, `tests/test_frontend.js`.

Pendências:
- Backend Flask (`/api/generate`) não recebe o campo do site; o furo só é aplicado pela configuração `business.signature_hole_id`, como o alvo de carga.

## Atualização: interface limpa e botões de download
Motivo: a página tinha textos de apoio repetidos (eyebrow, subtítulos, dicas de campo e descrições dos cinco arquivos) e os botões de download apareciam como links pequenos com seta ("Baixar plano realizado (.xlsx) →"), sem peso visual de botão.

Escopo (somente interface pública, `public/` espelhado em `docs/`):
- Removidos textos redundantes: eyebrow e parágrafo do topo, hint "O processamento acontece neste navegador", hint das etapas, textos de ajuda de identificação, data, horário, fuso, carga-alvo e furo de assinatura, subtítulo de Modelos de apoio, descrições do tutorial de anexos. O texto de ajuda de Forçar execução foi encurtado.
- Mantidos: nomes dos cinco arquivos, rótulos de campos, nota "obrigatório sem o Historial da BMO", linha "Máximo preservado", mensagens de validação e avisos.
- Botões: setas "→" e "↓" removidas. "Baixar plano realizado" e "Baixar log local" usam `.download` com ícone SVG (estilo primário e secundário). Modelos de apoio usam `.download--secondary` e o rótulo sem o prefixo "Modelo - ".
- Relatórios não alterados: Excel (incluindo aba `Resumo`), log de erro e regras de processamento não foram tocados.

Testes: `tests/test_frontend.js` (espelho `docs/`, nomes dos modelos e textos de contrato), suíte completa em `tests/*.js` e `tests/*.py`.

## Atualização: cargas iguais na carga mínima (site)
Motivo: ao informar a carga mínima por furo, dezenas de furos saíam exatamente com o mínimo (ex.: 269 furos com 21,00 kg num plano com furos zerados), e a distribuição do alvo podia repetir cargas perto do máximo. Pedidos do usuário: nenhuma carga se repete; os furos de carga baixa ficam baixos, variando em decimais; o passo não precisa ser fixo, o sistema escolhe o que representa melhor o cenário sem alterar a realidade; o furo de assinatura e os de maior carga não mudam; os demais podem ser ajustados.

Ordem aplicada (AGENTS.md): especificação (SPEC, PIPELINE, DATA_SCHEMA), configuração (`business.charge_minimum_step_kg` em `config.yaml`, com teto de 5 kg; `chargeMinimumStepKg` em `public/config.js` e `docs/config.js`), processamento (`public/charge.js`, `distributeCharges`; `public/app.js` passa `stepKg` e recebe os avisos em `notes`), testes e documentação.

- Furos de carga baixa ficam entre o mínimo e a próxima carga real do plano, em escada na ordem da carga original. O passo é o maior que cabe nesse espaço, até o teto configurado. Se não houver espaço, o passo é reduzido e o resultado avisa.
- Os demais furos livres absorvem a diferença do total com valores distintos entre um piso e um teto escalonados (teto logo abaixo do máximo preservado). Se o total não couber só com eles, os furos de carga baixa sobem proporcionalmente, com aviso.
- Cargas de origem iguais acima do mínimo são separadas por 0,001 kg. Desempate de 1e-6 kg quando sobra repetição por arredondamento; o total fecha exatamente.
- Alvos que não permitem cargas distintas (muito perto do menor ou do maior valor possível) são recusados com mensagem explícita.
- O resultado mostra "Furos na carga mínima" (normalmente 1) e os avisos de passo reduzido e de elevação dos furos baixos.
- Testes: `tests/test_charge.js` (escada automática abaixo da próxima carga real, aviso de passo reduzido com 60 furos baixos, alvo alto e caso do revisor sem repetição, recusa no limite inferior, varredura de 300 cenários sem repetição), `tests/test_signature_hole.js`, `tests/test_browser_config.py` (espelho da chave), `tests/test_frontend.js` (ligação em `app.js` e `docs/`).
- CLI Python: a mesma regra foi portada para `src/pfr/charge_distribution.py` e ligada em `src/pfr/processing.py`. Paridade com o site verificada por `tests/test_charge_parity.py` (casos aleatórios, valores e avisos iguais). No REG RAMPA F3, a CLI gera 0 cargas repetidas (eram 174 furos) e total exato.
- Resolvido: o total da redistribuição padrão (antes 46.779,599748 kg para entrada de 46.779,60 kg) agora fecha exato, e os zerados não ficam negativos.
- Pendência aberta: a redistribuição padrão só vale com `redistribute_zero_charges` ligado; desligada, a saída segue a entrada e as repetições do Config Final reaparecem.

## Atualização: janela de furos vizinhos (regra de 3 furos)
Motivo: o usuário pediu "não ter furos repetidos nos 3 valores anteriores ou posteriores" ("ainda não está bom"). Achado: a regra anterior (todas as cargas distintas) separava cargas de origem iguais por 0,001 kg. No REG RAMPA F3 isso dava vizinhos como 51,9981 e 51,9991 (lidos como 52 e 52 em kg cheios) e um platô de 138,8 a 139,0 kg no alvo de 17.136,048 kg.

Decisões (para revisão do usuário):
- Janela: 3 posições antes e depois, na ordem do número (`business.charge_window_size` = 3). Cargas iguais são permitidas fora da janela.
- Diferença mínima dentro da janela: 0,6 kg (`business.charge_window_min_gap_kg` = 0,6), valor que o usuário citou ao escolher a variação. Se não couber, desce em passos de 0,01 kg (bisseção) até caber, com aviso.
- Furos fixos (menor carga positiva, maior carga preservada, assinatura) não são ajustados. Pares de fixos a menos de 0,6 kg na janela são mantidos e avisados (ex.: três furos de 10 kg numa planilha uniforme).
- Zerados: escada cíclica a partir de 0,01 kg, com W+1 níveis separados pela diferença mínima; os níveis se repetem a cada 4 zerados (permitido pela regra).
- Algoritmo: base proporcional (como antes) e depois ajuste local: o furo em violação vai ao valor mais próximo permitido e o total é compensado em outro furo livre, com a mesma variação em sentido oposto. Cada passo elimina uma violação sem criar outra, então termina.
- Removidos: `business.charge_zero_fill_step_kg` (CLI) e `zeroChargeStepKg` (site). Com a escada pela janela, o passo de 0,001 kg não tinha efeito.

Ordem aplicada (AGENTS.md): especificação (SPEC, PIPELINE, DATA_SCHEMA), configuração (`config.yaml` e os `config_PP*.yaml` com redistribuição ligada receberam `charge_window_size` e `charge_window_min_gap_kg`; `public/config.js` e `docs/config.js`), processamento (`public/charge.js`, `src/pfr/charge_distribution.py`, `src/pfr/processing.py`, `public/app.js`), testes e documentação.

Resultados verificados:
- REG RAMPA F3 (arquivo real, somente leitura), redistribuição padrão: 0 pares a até 3 posições com diferença menor que 0,6 kg; total 10.008,82 kg exato; 104 furos ajustados pela janela; CLI e site idênticos (valores e avisos).
- REG RAMPA F3 com alvo de 17.136,048 kg: 0 violações; total exato; 17 furos ajustados; 22 furos acima de 130 kg. O alvo empurra a carga para o topo, e o padrão 139 / 138,4 / 137,8 / 137,2 se repete a cada 4 furos, dentro da regra.
- Paridade CLI × site: `tests/test_charge_parity.py` compara 800 casos aleatórios (valores, avisos e recusas).
- Robustez: 3.000 casos na CLI com vazios, zeros, empates e furo de assinatura, sem exceção inesperada.
- Suítes: 10 suítes Node e 59 testes Python passam.

Pendências abertas:
(1) O alvo de 17.136,048 kg (`chargeTarget` / `charge_total_target_kg`) é 71% acima da soma da entrada (10.008,82 kg). Vale confirmar esse total antes de usar o bloco, porque é ele que empurra a carga para o topo.
(2) Com o bloco de carga-alvo ligado, o site parte da `InputedCharge` original, mas a CLI redistribui os zerados antes de fechar o total (`src/pfr/processing.py`, `build_output_frame`). Os resultados podem diferir nesse modo; a paridade verificada cobre o modo padrão e a função de fechamento isolada.
(3) Os `config_PP*.yaml` antigos não têm `charge_minimum_step_kg`; isso só afeta a CLI quando o fechamento de carga-alvo está ligado.
(4) Se a diferença cair abaixo de 0,6 kg (plano com menor carga muito baixa), o resultado avisa com o valor usado.

## Atualização: cargas repetidas na redistribuição padrão (site)
Motivo: no REG RAMPA F3 (320 furos, 1 zerado), a redistribuição padrão deixava 174 furos com carga repetida em 48 valores (ex.: 22,999977 kg em 11 furos), e o total saía com diferença de 0,000136 kg. Causa: a redistribuição só mexia nos zerados (todos iguais a 0,01 kg) e ajustava os demais na proporção, então cargas de origem iguais continuavam iguais; sem zerados, nada era ajustado. Com o bloco de carga-alvo, a repetição não aparecia.

Ordem aplicada (AGENTS.md): especificação (SPEC, PIPELINE, DATA_SCHEMA), configuração (`business.charge_zero_fill_step_kg` em `config.yaml`; `zeroChargeStepKg` em `public/config.js` e `docs/config.js`), processamento (`public/charge.js`, `redistributeZeroCharges`; `public/app.js` passa o passo e os avisos e, com o bloco ligado, parte da `InputedCharge` original), testes e documentação.

- Pinados com o valor de entrada: menor carga positiva (o furo de assinatura, se tiver essa carga; senão o primeiro), maior carga (empates) e furo de assinatura. Os zerados ficam em escada a partir de 0,01 kg, em passo de 0,001 kg (reduzido com aviso se não couber abaixo da menor carga positiva).
- Zerados: escada a partir de 0,01 kg em passo de 0,001 kg (reduzido com aviso se não couber abaixo da menor carga positiva).
- Demais furos: absorvem a diferença em proporção ao excesso sobre a menor carga; cargas iguais separadas por 0,001 kg; desempate de 1e-6 kg; total exato.
- Com o bloco ligado, a redistribuição padrão não roda antes do bloco. Rodando antes, os furos de 21 kg exatos subiam acima do mínimo e a escada do bloco com mínimo de 21 kg colapsava para passos de 0,000002 kg.
- Aviso do bloco: o passo passou a ser mostrado com 6 casas (antes era arredondado para 3: "0,007" no lugar de 0,006666 kg).
- Testes: `tests/test_charge.js` (caso sintético com as repetições do REG RAMPA F3, 60 zerados, passo reduzido, recusas, furo de assinatura, bloco com mínimo de 3 e de 21 kg, varredura de 200 cenários), `tests/test_signature_hole.js`, `tests/test_browser_config.py` (espelho dos dois passos), `tests/test_frontend.js` (ligação em `app.js` e `docs/`).
- Resultado no REG RAMPA F3, executando `generateLocally` do `public/app.js` sobre os CSV e o PDF de entrada (somente leitura, saída em rascunho): sem bloco, antes 174 furos repetidos (48 valores) e total 10.008,820136 kg; depois 0 repetidos e total 10.008,82 kg. Com bloco (mínimo 3 kg e 21 kg, alvo = soma da entrada, ID 141): 0 repetidos antes e depois, total 10.008,82 kg.
- Pendências abertas: (1) a CLI (`src/pfr/processing.py`, `_redistribute_zero_charges`) ainda usa a regra anterior, com a mesma repetição; não foi alterada nesta rodada, que cobre só o site; (2) `chargeTarget` de `public/config.js` deixou de ser lido pela redistribuição padrão (permanece como espelho de `business.charge_total_target_kg`).
