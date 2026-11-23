// ====================================================================
// Calculos do site a partir do canal ThingSpeak da estacao (firmware v2)
//
// field1 = temperatura (C, media 1 min)     field5 = vento medio (km/h, 10 min)
// field2 = umidade (%, media 1 min)         field6 = rajada (km/h, 10 min)
// field3 = pressao na estacao (hPa, 1 min)  field7 = direcao (graus, 10 min; vazio = calmo)
// field4 = chuva do dia (mm, desde 00:00)   field8 = indice de chuva (0-100, regra local)
// ====================================================================

// Altitude do sensor de pressao, em metros. MEDIR no local (Google Earth + altura da caixa).
const ALTITUDE_M = 0;

// days=1 traz as ultimas 24 h (~1440 entradas): serve para o "agora",
// para a maxima/minima do dia e para o sinal de chuva.
const URL_TS =
  "https://api.thingspeak.com/channels/3577116/feeds.json?days=1&api_key=VGDJXJVKR05MDRV0";

// So a ultima entrada do canal (usada quando nao ha nada nas ultimas 24 h)
const URL_ULTIMA = URL_TS.replace("days=1", "results=1");

// ====================================================================
// 1. BUSCAR OS DADOS E CALCULAR TUDO
// ====================================================================

async function atualizar() {
  try {
    let feeds = await buscarFeeds(URL_TS); // mais antiga primeiro

    // estacao sem enviar ha mais de 24 h: busca a ultima entrada que existir
    if (feeds.length === 0) feeds = await buscarFeeds(URL_ULTIMA);
    if (feeds.length === 0) return; // nada a mostrar: a tela fica como esta

    const e = ultimaLeitura(feeds); // ultimo valor valido de cada campo
    const temp = num(e.field1),
      ur = num(e.field2);
    const extremos = maxMinDoDia(feeds);
    const sensacao = sensacaoTermica(temp, ur);
    const mmh = intensidadeChuva(feeds);

    const tela = {
      online: estacaoOnline(e), // false = mostrar "estacao sem sinal"
      atualizadoEm: horaLocal(e.created_at), // "14:35"

      temperatura: temp,
      tempMax: extremos.max,
      tempMin: extremos.min,
      sensacao: sensacao.valor,
      alertaCalor: alertaCalor(sensacao.valor),
      umidade: ur,
      orvalho: pontoOrvalho(temp, ur),

      pressao: pressaoNivelMar(e.field3, temp),
      tendencia: tendenciaPressao(feeds), // "subindo" / "estavel" / "caindo"
      difPressao: num(e.field3) - valor3hAtras(feeds, "field3"), // hPa em 3 h

      ventoMedio: num(e.field5),
      rajada: num(e.field6),
      direcao: textoDirecao(e.field7, e.field5),
      direcaoGraus: num(e.field7), // NaN = calmo ou sem leitura
      ultimaDirecao: ultimaDirecaoValida(feeds), // para a seta quando estiver calmo

      chuvaHoje: num(e.field4),
      intensidade: mmh,
      classeChuva: classeChuva(mmh),

      indice: num(e.field8),
      motivos: motivosIndice(feeds),
      sinalChuva: sinalDeChuva(feeds).texto,
      icone: iconeDoTempo(feeds),
    };

    // escreve cada valor de "tela" no HTML
    mostrar(tela);
    atualizarGraficos(feeds);
  } catch (erro) {
    console.log("Erro ao atualizar (tentando de novo em 1 min):", erro);
  }
}

// ====================================================================
// 2. UTILITARIOS
// ====================================================================

// Texto do ThingSpeak -> numero (vazio ou null vira NaN, nunca 0)
const num = (v) =>
  v === null || v === undefined || v === "" ? NaN : Number(v);

const tempo = (f) => Date.parse(f.created_at);

async function buscarFeeds(url) {
  const resp = await fetch(url);
  const dados = await resp.json();
  return Array.isArray(dados.feeds) ? dados.feeds : [];
}

// A leitura mais recente, mas com cada campo vindo da ultima entrada em que
// ele chegou preenchido. Assim um campo vazio numa entrada nao vira "--".
function ultimaLeitura(feeds) {
  const r = { created_at: feeds.at(-1).created_at };
  for (const c of ["field1", "field2", "field3", "field4", "field5", "field6", "field8"]) {
    const f = feeds.findLast((x) => !isNaN(num(x[c])));
    r[c] = f ? f[c] : null;
  }
  // direcao vazia quer dizer "calmo": vem da mesma entrada do vento medio
  const fv = feeds.findLast((x) => !isNaN(num(x.field5)));
  r.field7 = fv ? fv.field7 : null;
  return r;
}

// "2026-11-18T14:54:13Z" -> "11:54" (UTC-3)
function horaLocal(iso) {
  const d = new Date(Date.parse(iso) - 3 * 3600000);
  return d.toISOString().slice(11, 16);
}

// Data local "2026-11-18" de uma entrada
function diaLocal(iso) {
  return new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);
}

// Ultima leitura com mais de 5 min = estacao sem sinal
function estacaoOnline(e) {
  return Date.now() - Date.parse(e.created_at) < 5 * 60000;
}

// ====================================================================
// 3. TEMPERATURA E UMIDADE
// ====================================================================

// Ponto de orvalho, formula de Magnus (a = 17,62; b = 243,12), em C
function pontoOrvalho(t, ur) {
  t = num(t);
  ur = num(ur);
  if (isNaN(t) || isNaN(ur) || ur <= 0) return NaN;
  const a = 17.62,
    b = 243.12;
  const g = Math.log(ur / 100) + (a * t) / (b + t);
  return (b * g) / (a - g);
}

// Sensacao termica: indice de calor da NOAA (Rothfusz + ajustes oficiais).
// So com T >= 27 C e UR >= 40 %; fora disso, a sensacao e a propria temperatura.
function sensacaoTermica(tC, ur) {
  tC = num(tC);
  ur = num(ur);
  if (isNaN(tC) || isNaN(ur)) return { valor: NaN, aplicado: false };
  if (tC < 27 || ur < 40) return { valor: tC, aplicado: false };

  const T = tC * 1.8 + 32,
    R = ur;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);

  if ((hi + T) / 2 >= 80) {
    hi =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;

    if (R < 13 && T >= 80 && T <= 112)
      hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87)
      hi += ((R - 85) / 10) * ((87 - T) / 5);
  }

  return { valor: (hi - 32) / 1.8, aplicado: true };
}

// Faixas atuais do NWS/NOAA para o indice de calor:
// 80-90 F (27-32 C), 90-103 F (32-39 C), 103-124 F (39-52 C), 125 F ou mais (52 C ou mais)
function alertaCalor(hiC) {
  if (isNaN(hiC) || hiC < 27) return "";
  if (hiC < 32) return "Cuidado";
  if (hiC < 39.4) return "Cuidado extremo";
  if (hiC < 51.7) return "Perigo";
  return "Perigo extremo";
}

// Maxima e minima de hoje (desde 00:00 local), a partir das medias de 1 min
function maxMinDoDia(feeds) {
  const hoje = diaLocal(feeds.at(-1).created_at);
  const temps = feeds
    .filter((f) => diaLocal(f.created_at) === hoje)
    .map((f) => num(f.field1))
    .filter((t) => !isNaN(t));
  if (temps.length === 0) return { max: NaN, min: NaN };
  return { max: Math.max(...temps), min: Math.min(...temps) };
}

// ====================================================================
// 4. PRESSAO
// ====================================================================

// Pressao reduzida ao nivel do mar (hPa)
function pressaoNivelMar(p, t, altitudeM = ALTITUDE_M) {
  p = num(p);
  t = num(t);
  if (isNaN(p)) return NaN;
  if (isNaN(t)) t = 15;
  const h = altitudeM;
  return p * Math.pow(1 - (0.0065 * h) / (t + 0.0065 * h + 273.15), -5.257);
}

// Tendencia de 3 h (OMM): mais de 1 hPa = subindo ou caindo
function tendenciaPressao(feeds) {
  const dif = num(ultimaLeitura(feeds).field3) - valor3hAtras(feeds, "field3");
  if (isNaN(dif)) return "";
  if (dif > 1) return "subindo";
  if (dif < -1) return "caindo";
  return "estavel";
}

// ====================================================================
// 5. VENTO
// ====================================================================

const NOMES_DIRECAO = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"]; // L = leste

// Ponto cardeal (a biruta tem 8 setores) ou "Calmo"
function textoDirecao(graus, ventoKmh) {
  graus = num(graus);
  ventoKmh = num(ventoKmh);
  if (isNaN(graus)) return !isNaN(ventoKmh) && ventoKmh < 1.8 ? "Calmo" : "--";
  return NOMES_DIRECAO[Math.floor((graus + 22.5) / 45) % 8];
}

// ====================================================================
// 6. CHUVA
// ====================================================================

// Intensidade (mm/h) nos ultimos 'janelaMin' minutos; trata a virada do dia
function intensidadeChuva(feeds, janelaMin = 10) {
  if (!feeds || feeds.length < 2) return NaN;
  const tFim = tempo(feeds.at(-1));

  let total = 0,
    anterior = null,
    tIni = tFim;
  for (const f of feeds) {
    const t = tempo(f);
    if (tFim - t > janelaMin * 60000) continue;
    const v = num(f.field4);
    if (isNaN(v)) continue;
    if (anterior !== null)
      total += v >= anterior ? v - anterior : v; // zerou: dia novo
    else tIni = t;
    anterior = v;
  }
  const minutos = (tFim - tIni) / 60000;
  return minutos > 0 ? (total / minutos) * 60 : NaN;
}

function classeChuva(mmh) {
  if (isNaN(mmh) || mmh <= 0) return "Sem chuva";
  if (mmh < 2.5) return "Fraca";
  if (mmh < 10) return "Moderada";
  if (mmh < 50) return "Forte";
  return "Muito forte";
}

// Sinal de chuva: chovendo agora? indice alto? indice subindo em 30 min?
function sinalDeChuva(feeds) {
  const ultimo = feeds.findLast((f) => !isNaN(num(f.field8))) || feeds.at(-1);
  const indice = num(ultimo.field8);

  if (intensidadeChuva(feeds) > 0)
    return { nivel: "chovendo", texto: "Chovendo agora" };
  if (isNaN(indice))
    return { nivel: "sem-dado", texto: "Sem dados suficientes" };

  const antes = feeds.findLast((f) => tempo(ultimo) - tempo(f) >= 30 * 60000);
  const subindo = antes && indice - num(antes.field8) >= 10;

  if (indice >= 75)
    return { nivel: "muito-provavel", texto: "Chuva muito provavel" };
  if (indice >= 50) return { nivel: "provavel", texto: "Chuva provavel" };
  if (indice >= 25 || subindo)
    return { nivel: "possivel", texto: "Possibilidade de chuva" };
  return { nivel: "improvavel", texto: "Sem sinais de chuva" };
}

// ====================================================================
// 7. ICONE DO CARD
// ====================================================================

// Nome do icone: chuva, nublado, sol-entre-nuvens, lua-entre-nuvens, sol, lua, sem-dado
function iconeDoTempo(feeds) {
  const sinal = sinalDeChuva(feeds);
  const hora = (new Date(feeds.at(-1).created_at).getUTCHours() + 21) % 24; // UTC -> local
  const dia = hora >= 6 && hora < 18;

  switch (sinal.nivel) {
    case "chovendo":
      return "chuva";
    case "muito-provavel":
      return "nublado";
    case "provavel":
      return "nublado";
    case "possivel":
      return dia ? "sol-entre-nuvens" : "lua-entre-nuvens";
    case "improvavel":
      return dia ? "sol" : "lua";
    default:
      return "sem-dado";
  }
}

// nome que iconeDoTempo() devolve -> classe da weather-iconic
const ICONES = {
  "chuva":            "weather-cloud-rain",
  "nublado":          "weather-clouds",
  "sol-entre-nuvens": "weather-sun-cloud",
  "lua-entre-nuvens": "weather-moon-cloud",
  "sol":              "weather-sun",
  "lua":              "weather-moon",
  "sem-dado":         "weather-na",
};

// escreve um numero no elemento; NaN vira "--"
function poe(id, valor, casas = 0) {
  const el = document.getElementById(id);
  if (!el) return;                       // id que nao existe no HTML: ignora
  el.textContent =
    typeof valor === "number" ? (isNaN(valor) ? "--" : valor.toFixed(casas)) : valor;
}

function mostrar(tela) {
  poe("temperatura", tela.temperatura, 1);
  poe("temp-max",    tela.tempMax, 1);
  poe("temp-min",    tela.tempMin, 1);
  poe("sensacao",    tela.sensacao, 0);
  poe("alerta-calor", tela.alertaCalor);
  const alerta = document.getElementById("alerta-calor");
  if (alerta) alerta.hidden = tela.alertaCalor === ""; // sem calor: a etiqueta some
  poe("umidade",     tela.umidade, 0);
  poe("orvalho",     tela.orvalho, 1);
  poe("pressao",     tela.pressao, 1);
  poe("tendencia",   textoTendencia(tela.difPressao));
  poe("vento",       tela.ventoMedio, 1);
  poe("rajada",      tela.rajada, 1);
  poe("direcao", tela.direcao === "Calmo" ? "calmo" : `de ${tela.direcao}`);
  poe("chuva",       tela.chuvaHoje, 2);
  poe("chuva-texto", textoChuvaAgora(tela.intensidade));
  // calmo: a seta mostra a ultima direcao registrada, apagada
  if (isNaN(tela.direcaoGraus)) girarSeta(tela.ultimaDirecao, true);
  else girarSeta(tela.direcaoGraus, false);
  poe("sinal-chuva", tela.sinalChuva);
  poe("hora", tela.atualizadoEm);
  const bolinha = document.getElementById("status-bolinha");
  if (bolinha) bolinha.classList.toggle("offline", !tela.online); // verde = no ar, laranja = sem sinal

  // icone do card (weather-iconic): fica o da ultima leitura, mesmo sem sinal
  const icone = document.getElementById("icone");
  if (icone) icone.className = `weather ${ICONES[tela.icone]}`;

  mostrarIndice(tela);
}

// ====================================================================
// 8. CARD DO INDICE LOCAL DE CHUVA
// ====================================================================

// Mesmas faixas do OLED da estacao
const FAIXAS_INDICE = [
  { ate: 25,  nome: "Baixa",      classe: "nivel-baixa",      frase: "Pouca chance de chuva agora." },
  { ate: 50,  nome: "Média",      classe: "nivel-media",      frase: "Chuva possível; vale ficar atento." },
  { ate: 75,  nome: "Alta",       classe: "nivel-alta",       frase: "Chuva provável nas próximas horas." },
  { ate: 101, nome: "Muito alta", classe: "nivel-muito-alta", frase: "Chuva muito provável." },
];

// Valor de um campo ~3 h antes da ultima leitura (NaN se houver lacuna nos dados)
function valor3hAtras(feeds, campo) {
  const ultimo = feeds.at(-1);
  const antes = feeds.findLast(
    (f) => tempo(ultimo) - tempo(f) >= 3 * 3600000 && !isNaN(num(f[campo]))
  );
  if (!antes || tempo(ultimo) - tempo(antes) > 3.5 * 3600000) return NaN; // lacuna nos dados
  return num(antes[campo]);
}

// Motivos por tras do indice, com os criterios do firmware.
// conta = true quando o item puxa o indice para cima (bolinha colorida no card)
function motivosIndice(feeds) {
  const e = ultimaLeitura(feeds);
  const t = num(e.field1), ur = num(e.field2), p = num(e.field3);
  const sinal = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
  const m = [];

  if (intensidadeChuva(feeds) > 0)
    m.push({ texto: "Choveu nos últimos 10 minutos.", conta: true });

  const dP = p - valor3hAtras(feeds, "field3");
  if (!isNaN(dP)) {
    if (dP <= -1)        m.push({ texto: `Pressão caindo (${sinal(dP)} hPa em 3 h).`, conta: true });
    else if (dP <= -0.5) m.push({ texto: `Pressão caindo um pouco (${sinal(dP)} hPa em 3 h).`, conta: false });
    else if (dP >= 1.5)  m.push({ texto: `Pressão subindo (${sinal(dP)} hPa em 3 h).`, conta: false });
    else                 m.push({ texto: `Pressão estável (${sinal(dP)} hPa em 3 h).`, conta: false });
  }

  const dU = ur - valor3hAtras(feeds, "field2");
  if (!isNaN(dU) && dU >= 8)
    m.push({ texto: `Umidade subindo (${sinal(dU)} pontos em 3 h).`, conta: true });

  if (!isNaN(ur)) {
    const nome = ur >= 90 ? "muito alta" : ur >= 80 ? "alta" : ur >= 60 ? "moderada" : "baixa";
    m.push({ texto: `Umidade ${nome} (${ur.toFixed(0)}%).`, conta: ur >= 80 });
  }

  const dep = t - pontoOrvalho(t, ur);
  if (!isNaN(dep))
    m.push({ texto: `Temperatura a ${dep.toFixed(1)} °C do ponto de orvalho.`, conta: dep <= 4 });

  return m;
}

function mostrarIndice(tela) {
  const card = document.getElementById("card-indice");
  if (!card) return;

  const arco = document.getElementById("indice-arco");
  const lista = document.getElementById("indice-motivos");
  const C = 2 * Math.PI * 52; // circunferencia do anel (r = 52 no SVG)
  const idx = tela.indice;

  card.classList.remove(...FAIXAS_INDICE.map((f) => f.classe));
  lista.replaceChildren();

  if (isNaN(idx)) {
    poe("indice-valor", "--");
    poe("indice-nivel", "");
    poe("indice-frase", "Sem dados suficientes.");
    arco.style.strokeDasharray = `0 ${C}`;
    return;
  }

  const faixa = FAIXAS_INDICE.find((f) => idx < f.ate);
  card.classList.add(faixa.classe);

  poe("indice-valor", idx, 0);
  poe("indice-nivel", faixa.nome);
  poe("indice-frase", tela.intensidade > 0 ? "Chovendo agora." : faixa.frase);
  arco.style.strokeDasharray = `${(idx / 100) * C} ${C}`; // anel cheio = 100

  for (const motivo of tela.motivos) {
    const li = document.createElement("li");
    li.textContent = motivo.texto;
    if (motivo.conta) li.classList.add("conta");
    lista.append(li);
  }
}


// ====================================================================
// 9. CARDS DE UMIDADE, PRESSAO, CHUVA E VENTO
// ====================================================================

// "↓ caindo -1.3 hPa em 3 h"
function textoTendencia(dif) {
  if (isNaN(dif)) return "tendência: aguardando 3 h de dados";
  const v = `${dif > 0 ? "+" : ""}${dif.toFixed(1)} hPa em 3 h`;
  if (dif > 1) return `↑ subindo ${v}`;
  if (dif < -1) return `↓ caindo ${v}`;
  return `→ estável ${v}`;
}

// "sem chuva nos últimos 10 min" ou "chovendo: moderada (7.7 mm/h)"
function textoChuvaAgora(mmh) {
  if (isNaN(mmh) || mmh <= 0) return "sem chuva nos últimos 10 min";
  return `chovendo: ${classeChuva(mmh).toLowerCase()} (${mmh.toFixed(1)} mm/h)`;
}

// Ultima direcao que chegou preenchida nas 24 h (NaN se nenhuma)
function ultimaDirecaoValida(feeds) {
  const f = feeds.findLast((x) => !isNaN(num(x.field7)));
  return f ? num(f.field7) : NaN;
}

// Seta da rosa dos ventos: a ponta aponta DE ONDE o vento vem,
// igual ao texto ("de NE" -> ponta no NE).
// fraca = true: vento calmo, a seta mostra a ultima direcao, apagada.
function girarSeta(graus, fraca) {
  const seta = document.getElementById("vento-seta");
  if (!seta) return;
  if (isNaN(graus)) {
    seta.style.visibility = "hidden"; // nenhuma direcao nas ultimas 24 h
    return;
  }
  seta.style.visibility = "visible";
  seta.classList.toggle("fraca", fraca);
  seta.setAttribute("transform", `rotate(${graus} 60 60)`);
}

// ====================================================================
// 10. GRAFICOS DAS ULTIMAS 24 H (Chart.js): medias de 30 min, bolinhas ligadas
// ====================================================================

// Cores das series (validadas para daltonismo e contraste sobre o fundo do card)
const COR_AZUL = "#00809F";
const COR_LARANJA = "#D9730D";
const LAVAGEM_AZUL = "rgba(0, 128, 159, 0.10)"; // area sob a linha: 10% da cor

const PERIODO_H = 24;   // horas mostradas
const MEDIA_MIN = 30;   // cada bolinha = media de 30 min (48 pontos em 24 h)
const MARCA_H = 3;      // marcas do eixo a cada 3 h

const graficos = {};

function cssVar(nome, padrao) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || padrao;
}

// Agrupa as leituras de 1 min em intervalos de 'passoMin' minutos.
// modo: "media" (temperatura, umidade...), "max" (rajada) ou "ultimo" (chuva acumulada).
// Intervalo sem nenhuma leitura nao gera ponto: a linha o atravessa tracejada.
function agrupar(feeds, valor, passoMin, modo = "media") {
  const passo = passoMin * 60000;
  const grupos = new Map();
  for (const f of feeds) {
    const y = valor(f);
    if (isNaN(y)) continue;
    const chave = Math.floor(tempo(f) / passo);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(y);
  }
  const pts = [];
  for (const [chave, ys] of grupos) {
    let y;
    if (modo === "max") y = Math.max(...ys);
    else if (modo === "ultimo") y = ys.at(-1);
    else y = ys.reduce((a, b) => a + b, 0) / ys.length;
    pts.push({ x: chave * passo + passo / 2, y: Math.round(y * 100) / 100 }); // ponto no meio do intervalo
  }
  return pts.sort((a, b) => a.x - b.x);
}

// Chuva acumulada no periodo: soma os aumentos do field4 (que zera a meia-noite)
function chuvaAcumulada(feeds) {
  let total = 0, anterior = null;
  return feeds.map((f) => {
    const v = num(f.field4);
    if (isNaN(v)) return { ...f, acum: NaN };
    if (anterior !== null) total += v >= anterior ? v - anterior : v;
    anterior = v;
    return { ...f, acum: total };
  });
}

// Marcas do eixo de horas em horas cheias (hora local), a cada 'marcaH' horas
function marcasHora(eixo) {
  const passo = MARCA_H * 3600000;
  const marcas = [];
  for (let t = Math.ceil(eixo.min / passo) * passo; t <= eixo.max; t += passo) marcas.push({ value: t });
  eixo.ticks = marcas;
}

// Linha vertical que acompanha o mouse
const linhaVertical = {
  id: "linhaVertical",
  afterDatasetsDraw(chart) {
    const ativos = chart.tooltip && chart.tooltip.getActiveElements();
    if (!ativos || ativos.length === 0) return;
    const x = ativos[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(128, 128, 128, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// Trecho entre dois pontos mais distantes que 1,5 intervalo = estacao sem enviar
function ehLacuna(ctx) {
  const passo = MEDIA_MIN * 60000;
  return ctx.p1.parsed.x - ctx.p0.parsed.x > passo * 1.5;
}

// Ultimo ponto (valor atual) maior que os outros
const raioPonto = (ctx) => (ctx.dataIndex === ctx.dataset.data.length - 1 ? 4.5 : 2.5);

// Visual comum a toda serie. Lacuna: tracejado aberto e mais claro (sem dado ali).
function estiloSerie(cor, extra = {}) {
  const corLacuna = cor + "73"; // mesma cor com 45% de opacidade
  return {
    borderColor: cor,
    pointBackgroundColor: cor,
    pointBorderColor: "#FFFFFF",       // anel branco: bolinhas nao se fundem
    pointBorderWidth: 1,
    pointRadius: raioPonto,
    pointHoverRadius: 6,
    segment: {
      borderDash: (ctx) => (ehLacuna(ctx) ? [2, 6] : undefined),
      borderColor: (ctx) => (ehLacuna(ctx) ? corLacuna : undefined),
    },
    spanGaps: true,
    ...extra,
  };
}

// eixo = { unidade: "°C", casas: 1, zero: false }
function criarGrafico(id, datasets, eixo) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;

  const corTexto = cssVar("--texto-suave", "#557A80");
  const corGrade = "rgba(128, 128, 128, 0.18)";
  const fonte = { family: cssVar("--fonte", "Nunito, sans-serif"), size: 11 };

  return new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      elements: {
        point: { hitRadius: 10 },
        line: { borderWidth: 2, borderCapStyle: "round", borderJoinStyle: "round", tension: 0.25 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (itens) => horaLocal(new Date(itens[0].parsed.x).toISOString()),
            label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toFixed(eixo.casas)} ${eixo.unidade}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          afterBuildTicks: marcasHora,
          grid: { color: corGrade },
          border: { display: false },
          ticks: { color: corTexto, font: fonte, callback: (v) => horaLocal(new Date(v).toISOString()) },
        },
        y: {
          beginAtZero: eixo.zero,
          grace: eixo.zero ? 0 : "10%",
          grid: { color: corGrade },
          border: { display: false },
          ticks: {
            color: corTexto, font: fonte, maxTicksLimit: 5,
            callback: (v) => (Number.isInteger(v) ? v : v.toFixed(1)), // 1013, sem separador de milhar
          },
        },
      },
    },
    plugins: [linhaVertical],
  });
}

// Se o HTML nao carregou o Chart.js, o proprio script carrega e depois desenha
const URL_CHARTJS = "https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js";
let carregandoChart = false;

function carregarChartJs(depois) {
  if (carregandoChart) return;
  carregandoChart = true;
  const tag = document.createElement("script");
  tag.src = URL_CHARTJS;
  tag.onload = depois;
  tag.onerror = () => console.log("Nao foi possivel carregar o Chart.js:", URL_CHARTJS);
  document.head.append(tag);
}

function atualizarGraficos(feeds) {
  if (typeof Chart === "undefined") {
    carregarChartJs(() => atualizarGraficos(feeds));
    return;
  }

  // so as leituras das ultimas 24 h
  const fim = tempo(feeds.at(-1));
  const inicio = fim - PERIODO_H * 3600000;
  const doPeriodo = feeds.filter((f) => tempo(f) > inicio);
  const passo = MEDIA_MIN;
  const comChuva = chuvaAcumulada(doPeriodo);

  const series = {
    temp:    [agrupar(doPeriodo, (f) => num(f.field1), passo)],
    umidade: [agrupar(doPeriodo, (f) => num(f.field2), passo)],
    pressao: [agrupar(doPeriodo, (f) => pressaoNivelMar(f.field3, f.field1), passo)],
    chuva:   [agrupar(comChuva, (f) => f.acum, passo, "ultimo")],
    vento:   [agrupar(doPeriodo, (f) => num(f.field5), passo),
              agrupar(doPeriodo, (f) => num(f.field6), passo, "max")],
  };

  if (!graficos.temp) {
    graficos.temp = criarGrafico("graf-temp",
      [{ label: "Temperatura", data: [], ...estiloSerie(COR_LARANJA) }],
      { unidade: "°C", casas: 1, zero: false });
    graficos.umidade = criarGrafico("graf-umidade",
      [{ label: "Umidade", data: [], ...estiloSerie(COR_AZUL) }],
      { unidade: "%", casas: 0, zero: false });
    graficos.pressao = criarGrafico("graf-pressao",
      [{ label: "Pressão", data: [], ...estiloSerie(COR_AZUL) }],
      { unidade: "hPa", casas: 1, zero: false });
    graficos.chuva = criarGrafico("graf-chuva",
      [{ label: "Chuva acumulada", data: [],
         ...estiloSerie(COR_AZUL, { backgroundColor: LAVAGEM_AZUL, fill: "origin", stepped: "after", tension: 0 }) }],
      { unidade: "mm", casas: 2, zero: true });
    graficos.vento = criarGrafico("graf-vento",
      [{ label: "Vento médio", data: [], ...estiloSerie(COR_AZUL, { backgroundColor: LAVAGEM_AZUL, fill: "origin" }) },
       { label: "Rajada", data: [], ...estiloSerie(COR_LARANJA) }],
      { unidade: "km/h", casas: 1, zero: true });
  }

  for (const [nome, dados] of Object.entries(series)) {
    const g = graficos[nome];
    if (!g) continue; // canvas que nao existe no HTML: ignora
    dados.forEach((d, i) => (g.data.datasets[i].data = d));
    g.options.scales.x.min = inicio;
    g.options.scales.x.max = fim;
    g.update("none");
  }

  // total de chuva nas 24 h, ao lado do titulo do grafico
  const chuva = series.chuva[0];
  poe("chuva-24h", chuva.length ? chuva.at(-1).y : NaN, 2);
}

// ====================================================================
// 11. INICIAR (no fim: todas as funcoes ja existem)
// ====================================================================

atualizar();
setInterval(atualizar, 60000); // a estacao envia 1 vez por minuto