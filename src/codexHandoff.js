/**
 * 导出给 Codex。
 *
 * 说白了就是"把这只狗打包带走"：生成一份 JSON 参数清单和一张定妆照，
 * 再把一段可以直接粘给编码助手的说明复制到剪贴板。它不会去调用任何服务，
 * 也不会自动打开 Codex——只是把手上这只狗整理成别的工具读得懂的形式。
 */

function makeButton(label, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function download(href, filename) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 退回到 execCommand */
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function describe(descriptor) {
  const p = descriptor.parameters ?? {};
  const lines = [
    '这是一只用「汪汪生成器」捏出来的中华田园犬，下面是它的完整参数。',
    '几何是程序化的：每个数值都作用在对应的解剖构件上，不是缩放现成模型。',
    '',
    `姿势：${p.pose}　耳型：${p.earType}　耳尖：${p.earTip}　花色：${p.coatId}`,
    `背毛色 ${p.saddleColor}　底色 ${p.underColor}　眼睛 ${p.eyeColor}`,
    `头身比 ${p.headSize}　圆润度 ${p.chubbiness}　腿长 ${p.legLength}`,
    `躯干长度 ${p.torsoLength}　吻部长度 ${p.muzzleLength}`,
    `耳朵大小 ${p.earSize}　尾巴长度 ${p.tailLength}　尾巴卷曲 ${p.tailCurl}`,
    `眼睛大小 ${p.eyeSize}　瞳孔大小 ${p.irisScale}`,
    `眉点 ${p.eyebrowDots ? '有' : '无'}　吐舌头 ${p.tongueOut ? '是' : '否'}　炸毛 ${p.fluffy ? `是（${p.furFluff}）` : '否'}`,
    '',
    '毛色分三层：saddle 只染背上那块皮（鞍背），under 是腹部、胸口、四肢和',
    '口吻的底色，accent 是眉点和四肢点缀。背鞍的位置由沿脊柱的坐标决定，',
    '换姿势也会长在解剖学正确的位置上。',
  ];
  return lines.join('\n');
}

export function createCodexHandoff({ trigger, capturePreview, getDescriptor }) {
  if (!trigger) return null;

  const overlay = document.createElement('div');
  overlay.className = 'codex-overlay';
  overlay.hidden = true;

  const dialog = document.createElement('section');
  dialog.className = 'codex-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', '导出给 Codex');

  const close = makeButton('×', 'codex-close');
  close.setAttribute('aria-label', '关闭');

  const title = document.createElement('h2');
  title.textContent = '🐾 导出给 Codex';
  const subtitle = document.createElement('p');
  subtitle.className = 'codex-subtitle';
  subtitle.textContent = '把这只狗整理成参数清单和定妆照，不会连接任何服务';

  const preview = document.createElement('img');
  preview.className = 'codex-preview';
  preview.alt = '当前小狗的定妆照';
  preview.draggable = false;

  const summary = document.createElement('pre');
  summary.className = 'codex-summary';

  const actions = document.createElement('div');
  actions.className = 'codex-actions';
  const jsonButton = makeButton('下载参数 JSON', 'btn');
  const pngButton = makeButton('下载定妆照 PNG', 'btn');
  const copyButton = makeButton('复制说明文字', 'btn primary');
  actions.append(jsonButton, pngButton, copyButton);

  const status = document.createElement('p');
  status.className = 'codex-status';
  status.setAttribute('role', 'status');

  dialog.append(close, title, subtitle, preview, summary, actions, status);
  overlay.append(dialog);
  document.body.appendChild(overlay);

  let descriptor = null;
  let previewUrl = '';

  function open() {
    descriptor = getDescriptor();
    previewUrl = capturePreview();
    preview.src = previewUrl;
    summary.textContent = describe(descriptor);
    status.textContent = '';
    overlay.hidden = false;
  }

  function hide() {
    overlay.hidden = true;
  }

  trigger.addEventListener('click', open);
  close.addEventListener('click', hide);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) hide();
  });

  jsonButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(descriptor, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    download(url, 'woof-pet.json');
    URL.revokeObjectURL(url);
    status.textContent = '参数清单已下载';
  });

  pngButton.addEventListener('click', () => {
    download(previewUrl, 'woof-pet.png');
    status.textContent = '定妆照已下载';
  });

  copyButton.addEventListener('click', async () => {
    const text = `${describe(descriptor)}\n\n${JSON.stringify(descriptor, null, 2)}`;
    status.textContent = (await copyText(text)) ? '说明已复制到剪贴板' : '复制失败，可以手动选中上面的文字';
  });

  return { open, hide };
}
