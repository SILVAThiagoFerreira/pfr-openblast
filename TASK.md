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
- O site deve importar um arquivo `.brex` do BMO pelo botão "Importar BREX (BMO)", listar os disparos com ajuste de horário em horas (padrão `business.brex_offset_hours`) aplicado ao vivo e preencher o horário de desmonte com o disparo escolhido (HH:MM:SS). Os disparos que combinam com o ID informado ficam em destaque e primeiro na lista.
- O site deve oferecer conversão de fuso no processamento, com `UTC-03:00` como opção padrão e o resultado registrado no Excel.
- O site deve disponibilizar exatamente os três modelos oficiais para download, preservando os nomes originais: “Plano de Fogo - PC.xls” (Modelo - Pré-Corte - SEM FUROS), “Plano de Fogo Realizado - PP.xlsx” (Modelo - Produção) e “Plano Realizado - REG .xls” (Modelo - Regularização).

Critério objetivo de conclusão:
- o projeto possui documentação completa;
- a configuração centraliza caminhos e parâmetros;
- o fluxo executa por um único entrypoint;
- as etapas de leitura, validação, processamento e exportação estão separadas.

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
