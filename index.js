/**
 * Persona Gen - User Character Sheet Generator for SillyTavern
 * {{char}} 디스크립션 기반 {{user}} 프로필 생성
 */

const EXT_NAME = 'st-PersonaGen';

const DEFAULTS = {
    enabled: true,
    apiSource: 'main',
    connectionProfileId: '',
    lang: 'ko',
    detailLevel: 'normal',
    extraPrompt: '',
};

let cfg = {};
let ctx = null;
let generating = false;
let lastResult = '';
let lastInputs = {};

function persist() { ctx.saveSettingsDebounced(); }

function esc(str) {
    const d = document.createElement('span');
    d.textContent = str;
    return d.innerHTML;
}

// ─── 복사 유틸 ───

async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    }
    try {
        const el = document.createElement('span');
        el.textContent = text;
        el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;white-space:pre-wrap;';
        document.body.appendChild(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        document.body.removeChild(el);
        if (ok) return true;
    } catch (e) { /* fall through */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) return true;
    } catch (e) { /* fall through */ }
    return false;
}

// ─── 부팅 ───

async function boot() {
    console.log(`[${EXT_NAME}] Booting...`);
    ctx = SillyTavern.getContext();

    if (!ctx.extensionSettings[EXT_NAME]) {
        ctx.extensionSettings[EXT_NAME] = structuredClone(DEFAULTS);
    }
    cfg = ctx.extensionSettings[EXT_NAME];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (cfg[k] === undefined) cfg[k] = v;
    }

    await mountSettings();
    bindEvents();
    console.log(`[${EXT_NAME}] Ready.`);
}

// ─── 설정 패널 ───

async function mountSettings() {
    const html = await ctx.renderExtensionTemplateAsync(`third-party/${EXT_NAME}`, 'settings');
    $('#extensions_settings').append(html);
    const root = $('.persona_gen_settings');

    root.find('.pg_enabled').prop('checked', cfg.enabled).on('change', function () {
        cfg.enabled = $(this).prop('checked'); persist();
        updateMenuVisibility();
        toastr.info(cfg.enabled ? 'Persona Gen 활성화됨' : 'Persona Gen 비활성화됨');
    });

    // API 소스
    const sourceSelect = root.find('.pg_source');
    sourceSelect.empty();
    sourceSelect.append('<option value="main">Main API</option>');

    try {
        const cmrs = ctx.ConnectionManagerRequestService;
        let profiles = [];
        if (cmrs) {
            if (typeof cmrs.getConnectionProfiles === 'function') profiles = cmrs.getConnectionProfiles() || [];
            else if (typeof cmrs.getAllProfiles === 'function') profiles = cmrs.getAllProfiles() || [];
            else if (typeof cmrs.getProfiles === 'function') profiles = cmrs.getProfiles() || [];
            if (!profiles.length) {
                const s = ctx.extensionSettings?.connectionManager?.profiles
                    || ctx.extensionSettings?.ConnectionManager?.profiles;
                if (Array.isArray(s)) profiles = s;
                else if (s && typeof s === 'object') profiles = Object.values(s);
            }
        }
        if (profiles.length) {
            profiles.forEach(p => {
                const id = p.id || p.profileId || '';
                const name = p.name || p.profileName || id;
                if (id) sourceSelect.append(`<option value="profile:${id}">${name}</option>`);
            });
        }
    } catch (e) {
        console.log(`[${EXT_NAME}] 프로필 목록 로드 실패:`, e);
    }

    const currentVal = cfg.apiSource === 'profile' && cfg.connectionProfileId
        ? `profile:${cfg.connectionProfileId}` : 'main';
    sourceSelect.val(currentVal);
    sourceSelect.on('change', function () {
        const val = $(this).val();
        if (val === 'main') {
            cfg.apiSource = 'main';
            cfg.connectionProfileId = '';
        } else {
            cfg.apiSource = 'profile';
            cfg.connectionProfileId = val.replace('profile:', '');
        }
        persist();
    });

    root.find('.pg_lang').val(cfg.lang).on('change', function () { cfg.lang = $(this).val(); persist(); });
    root.find('.pg_detail').val(cfg.detailLevel).on('change', function () { cfg.detailLevel = $(this).val(); persist(); });
    root.find('.pg_extra_prompt').val(cfg.extraPrompt).on('change', function () { cfg.extraPrompt = $(this).val(); persist(); });
}

// ─── 이벤트 ───

function updateMenuVisibility() {
    const btn = document.getElementById('pg_menu_btn');
    if (btn) btn.style.display = cfg.enabled ? '' : 'none';
}

function bindEvents() {
    const menuBtn = document.createElement('div');
    menuBtn.id = 'pg_menu_btn';
    menuBtn.className = 'list-group-item flex-container flexGap5 interactable';
    menuBtn.title = '페르소나 생성';
    menuBtn.innerHTML = '<i class="fa-solid fa-user-pen"></i> 페르소나 생성';
    menuBtn.style.display = cfg.enabled ? '' : 'none';

    menuBtn.addEventListener('click', () => {
        if (!cfg.enabled || generating) return;
        $('#extensionsMenu').hide();
        showInputForm();
    });

    const extMenu = document.getElementById('extensionsMenu');
    if (extMenu) {
        extMenu.appendChild(menuBtn);
    } else {
        const obs = new MutationObserver((_, o) => {
            const m = document.getElementById('extensionsMenu');
            if (m) { m.appendChild(menuBtn); o.disconnect(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
}

// ─── 캐릭터 데이터 ───

function getCharacterData() {
    try {
        const c = SillyTavern.getContext();
        const ch = c.characters?.[c.characterId];
        if (!ch) return null;
        const d = ch.data || ch;
        return {
            name: ch.name || '',
            description: d.description || '',
            personality: d.personality || '',
            scenario: d.scenario || '',
        };
    } catch { return null; }
}

// ─── UI ───

function removeBlock() { $('#pg-block').remove(); }

function scrollToBlock() {
    const el = document.getElementById('pg-block');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function showInputForm() {
    removeBlock();
    const char = getCharacterData();
    if (!char) { toastr.warning('캐릭터가 선택되지 않았습니다.'); return; }

    const block = $('<div id="pg-block" class="pg-block"></div>');

    const head = $('<div class="pg-block-head"></div>');
    head.append(`<span class="pg-block-title">👤 페르소나 생성 — ${esc(char.name)}</span>`);
    const closeBtn = $('<button class="pg-block-btn" title="닫기">✕</button>');
    closeBtn.on('click', removeBlock);
    head.append(closeBtn);
    block.append(head);

    const form = $(`
        <div class="pg-form">
            <div class="pg-form-row">
                <div class="pg-form-field">
                    <small>이름</small>
                    <input type="text" class="pg-input-name" placeholder="비우면 자동 생성" value="${esc(lastInputs.name || '')}" />
                </div>
                <div class="pg-form-field">
                    <small>나이</small>
                    <input type="text" class="pg-input-age" placeholder="비우면 자동 생성" value="${esc(lastInputs.age || '')}" />
                </div>
            </div>
            <div class="pg-form-field">
                <small>외모</small>
                <textarea class="pg-input-appearance" rows="2" placeholder="비우면 자동 생성">${esc(lastInputs.appearance || '')}</textarea>
            </div>
            <div class="pg-form-field">
                <small>특징 / 성격</small>
                <textarea class="pg-input-traits" rows="2" placeholder="비우면 자동 생성">${esc(lastInputs.traits || '')}</textarea>
            </div>
            <div class="pg-form-actions">
                <button class="pg-btn pg-btn-cancel">취소</button>
                <button class="pg-btn pg-btn-primary pg-btn-generate">생성</button>
            </div>
        </div>
    `);

    form.find('.pg-btn-cancel').on('click', removeBlock);
    form.find('.pg-btn-generate').on('click', () => {
        const inputs = {
            name: form.find('.pg-input-name').val().trim(),
            age: form.find('.pg-input-age').val().trim(),
            appearance: form.find('.pg-input-appearance').val().trim(),
            traits: form.find('.pg-input-traits').val().trim(),
        };
        lastInputs = inputs;
        generate(inputs, null);
    });

    block.append(form);
    $('#chat').append(block);
    scrollToBlock();
}

function showLoading() {
    removeBlock();
    const block = $('<div id="pg-block" class="pg-block"></div>');
    block.html(`
        <div class="pg-block-head">
            <span class="pg-block-title">👤 페르소나 생성</span>
        </div>
        <div class="pg-loading">
            <div class="pg-dots"><span></span><span></span><span></span></div>
            <span>페르소나 생성 중...</span>
        </div>
    `);
    $('#chat').append(block);
    scrollToBlock();
}

function showResult(text) {
    removeBlock();
    lastResult = text;

    const block = $('<div id="pg-block" class="pg-block"></div>');

    const head = $('<div class="pg-block-head"></div>');
    head.append('<span class="pg-block-title">👤 페르소나 생성 결과</span>');
    const btns = $('<div class="pg-block-btns"></div>');
    btns.append('<button class="pg-block-btn pg-do-back" title="입력으로 돌아가기">↩️</button>');
    btns.append('<button class="pg-block-btn pg-do-close" title="닫기">✕</button>');
    head.append(btns);
    block.append(head);

    const result = $(`
        <div class="pg-result">
            <div class="pg-result-text">${esc(text)}</div>
            <div class="pg-result-actions">
                <button class="pg-result-act pg-act-copy">📋 복사</button>
            </div>
        </div>
    `);

    result.find('.pg-act-copy').on('click', async () => {
        const ok = await copyToClipboard(text);
        if (ok) toastr.success('복사됨');
    });

    block.append(result);

    // 수정사항 입력
    const revise = $(`
        <div class="pg-revise">
            <textarea class="pg-revise-input" rows="2" placeholder="수정사항 입력 (예: 나이를 25살로 변경, 성격을 더 활발하게)"></textarea>
            <button class="pg-btn pg-btn-primary pg-btn-revise">수정 반영</button>
        </div>
    `);

    revise.find('.pg-btn-revise').on('click', () => {
        const reviseText = revise.find('.pg-revise-input').val().trim();
        if (!reviseText) { toastr.warning('수정사항을 입력하세요.'); return; }
        generate(lastInputs, reviseText);
    });

    block.append(revise);

    block.find('.pg-do-back').on('click', () => showInputForm());
    block.find('.pg-do-close').on('click', removeBlock);

    $('#chat').append(block);
    scrollToBlock();
}

// ─── 생성 ───

async function generate(inputs, reviseText) {
    if (generating) return;

    if (cfg.apiSource === 'profile' && !cfg.connectionProfileId) {
        toastr.warning('Connection Profile을 선택하세요.'); return;
    }

    const char = getCharacterData();
    if (!char) { toastr.warning('캐릭터가 선택되지 않았습니다.'); return; }

    generating = true;
    showLoading();

    try {
        const instruction = buildPrompt(char, inputs, reviseText);
        let raw = '';

        if (cfg.apiSource === 'main') {
            const systemPrompt = buildSystemContext(char);
            const { generateRaw } = ctx;
            if (!generateRaw) throw new Error('generateRaw not available');
            raw = await generateRaw({ systemPrompt, prompt: instruction, streaming: false });
        } else {
            const msgs = [];
            msgs.push({ role: 'system', content: buildSystemContext(char) });
            msgs.push({ role: 'user', content: instruction });
            if (!ctx.ConnectionManagerRequestService) throw new Error('Connection Manager 미로드');
            const resp = await ctx.ConnectionManagerRequestService.sendRequest(
                cfg.connectionProfileId, msgs, 4000,
                { stream: false, extractData: true, includePreset: false, includeInstruct: false },
            ).catch(e => { throw new Error(`Profile 오류: ${e.message}`); });

            if (typeof resp === 'string') raw = resp;
            else if (resp?.choices?.[0]?.message) {
                const m = resp.choices[0].message;
                raw = m.reasoning_content || m.content || '';
            } else raw = resp?.content || resp?.message || '';
        }

        const parsed = parseResult(raw);
        if (!parsed) throw new Error('파싱 실패');

        showResult(parsed);

    } catch (err) {
        console.error(`[${EXT_NAME}]`, err);
        toastr.error(`페르소나 생성 실패: ${err.message}`);
        showInputForm();
    } finally {
        generating = false;
    }
}

// ─── 프롬프트 ───

function buildSystemContext(char) {
    let t = '=== CHARACTER INFO ===\n';
    if (char.name) t += `Name: ${char.name}\n`;
    if (char.description) t += `\nDescription:\n${char.description}\n`;
    if (char.personality) t += `\nPersonality:\n${char.personality}\n`;
    if (char.scenario) t += `\nScenario:\n${char.scenario}\n`;
    return t.trim();
}

function buildPrompt(char, inputs, reviseText) {
    const langNote = cfg.lang === 'ko'
        ? '⚠️ 모든 출력을 한국어로 작성하세요.'
        : '⚠️ Write all output in English.';

    const detailMap = {
        brief: 'Keep the profile concise and compact (around 200-400 characters)',
        normal: 'Write a moderately detailed profile (around 400-800 characters)',
        detailed: 'Write a comprehensive and detailed profile (around 800-1500 characters)',
    };

    let userHints = '';
    if (inputs.name) userHints += `- Name: ${inputs.name}\n`;
    if (inputs.age) userHints += `- Age: ${inputs.age}\n`;
    if (inputs.appearance) userHints += `- Appearance: ${inputs.appearance}\n`;
    if (inputs.traits) userHints += `- Traits/Personality: ${inputs.traits}\n`;

    let prompt = `You are a character profile writer for roleplay. Based on the character ({{char}}) information provided above, create a matching user character ({{user}}) profile.

CRITICAL RULES:
1. Analyze the FORMAT and STRUCTURE of {{char}}'s description carefully.
2. Write {{user}}'s profile in the SAME FORMAT as {{char}}'s description (e.g., if {{char}} uses prose style, use prose; if {{char}} uses structured fields, use the same field names; if {{char}} uses W++, use W++; if {{char}} uses JSON, use JSON).
3. The {{user}} character should complement {{char}} — someone who would naturally exist in the same world and interact meaningfully with {{char}}.
4. Any fields NOT specified by the user should be creatively filled in by you to match the setting and {{char}}'s world.

${langNote}
${detailMap[cfg.detailLevel] || detailMap.normal}`;

    if (userHints) {
        prompt += `\n\nUser-specified attributes (use these exactly, fill in everything else):\n${userHints}`;
    } else {
        prompt += '\n\nNo attributes specified — create everything from scratch to match {{char}}.';
    }

    if (cfg.extraPrompt) {
        prompt += `\n\nAdditional instructions:\n${cfg.extraPrompt}`;
    }

    if (reviseText) {
        prompt += `\n\n--- REVISION REQUEST ---\nThe previous output was:\n${lastResult}\n\nPlease revise according to this feedback:\n${reviseText}\n\nGenerate the COMPLETE revised profile, not just the changes.`;
    }

    prompt += `\n\nOUTPUT FORMAT:
- Output ONLY the character profile/description itself
- Do NOT include any explanation, commentary, or meta text
- Do NOT wrap in code blocks or tags
- Match {{char}}'s description format exactly`;

    return prompt;
}

// ─── 파싱 ───

function parseResult(raw) {
    if (!raw || !raw.trim()) return null;
    let text = raw.trim();
    // 코드블록 제거
    text = text.replace(/^```[\s\S]*?\n/, '').replace(/\n?```\s*$/, '');
    // 앞뒤 태그 제거
    text = text.replace(/^<[^>]+>\s*/i, '').replace(/\s*<\/[^>]+>$/i, '');
    return text.trim() || null;
}

// ─── 시작 ───

jQuery(async () => { await boot(); });
