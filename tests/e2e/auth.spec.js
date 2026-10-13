// Окно входа и регистрации. Запуск: npm run test:e2e
//
// До 10 октября 2026 создать аккаунт было почти нечем: окно всегда открывалось
// как «Вход», а ссылка «Создать аккаунт» появлялась только после неудачной
// попытки войти. Теперь у окна два явных режима, внизу строка-переключатель,
// а кнопка «Создать аккаунт» в настройках открывает сразу регистрацию.
//
// Настоящий Supabase из теста не трогаем — аккаунты заводит только человек.
// Подменяются методы клиента, которые зовёт окно: signUp, signInWithPassword,
// getUser и чтение профиля. Проверяется то, что видит и делает человек:
// заголовок, подпись кнопки, подсказка менеджеру паролей, что ушло в signUp и
// куда пустил ответ.
const { test, expect } = require('@playwright/test');

const EMAIL = 'new@example.com';
const PASSWORD = 'pass-12345';

const open = async (page) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
};

/** Подмена клиента: ответы задаёт тест, вызовы собираются в window.__calls. */
const stub = (page, cfg) => page.evaluate((c) => {
  window.__calls = [];
  sb.auth.signUp = async (args) => { window.__calls.push(['signUp', args]); return c.signUp; };
  sb.auth.signInWithPassword = async (args) => {
    window.__calls.push(['signIn', args]);
    return c.signIn || { data: {}, error: null };
  };
  sb.auth.getUser = async () => ({ data: { user: { id: 'u1', email: 'new@example.com' } } });
  // Профиля у нового аккаунта ещё нет — afterSignedIn откроет шаг согласия.
  sb.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
}, cfg);

const calls = (page) => page.evaluate(() => window.__calls);

const title = (page) => page.locator('#auth-title');
const sub = (page) => page.locator('#auth-sub');
const submit = (page) => page.locator('#auth-submit');
const email = (page) => page.locator('#auth-email');
const password = (page) => page.locator('#auth-password');
const error = (page) => page.locator('#auth-error');
const switchText = (page) => page.locator('#auth-switch-text');
const switchBtn = (page) => page.locator('#auth-switch-btn');

const fill = async (page) => {
  await email(page).fill(EMAIL);
  await password(page).fill(PASSWORD);
};

/** Открывает окно и дожидается его автофокуса на почту: он отложенный (30 мс).
 *  Раньше тесты шли к fill() сразу, и таймер срабатывал между focus() и
 *  вставкой текста у fill(): пароль падал в поле почты, поле пароля оставалось
 *  пустым, кнопка молча ничего не делала. Падало случайно, в каждом десятом
 *  прогоне. Приложение с тех пор не отнимает фокус у поля, куда встали раньше
 *  (тест ниже); ожидание осталось — оно проверяет и сам автофокус. */
const openAuth = async (page, mode) => {
  await page.evaluate((m) => openAuthModal(m), mode);
  await expect(email(page), 'окно ставит фокус на почту').toBeFocused();
};

test('окно входа: режимы «Вход» и «Регистрация» меняют заголовок, кнопку и подсказку для паролей', async ({ page }) => {
  await open(page);
  await openAuth(page);

  await expect(title(page)).toHaveText('Вход');
  await expect(submit(page)).toHaveText('Войти');
  await expect(password(page)).toHaveAttribute('autocomplete', 'current-password');
  await expect(switchText(page)).toHaveText('Нет аккаунта?');
  await expect(switchBtn(page)).toHaveText('Создать аккаунт');
  await expect(switchBtn(page), 'ссылка — общий .linklike, а не своя кнопка').toHaveClass(/linklike/);

  await switchBtn(page).click();
  await expect(title(page)).toHaveText('Регистрация');
  await expect(sub(page)).toContainText('Создайте аккаунт');
  await expect(submit(page)).toHaveText('Создать аккаунт');
  await expect(password(page)).toHaveAttribute('autocomplete', 'new-password');
  await expect(switchText(page)).toHaveText('Уже есть аккаунт?');
  await expect(switchBtn(page)).toHaveText('Войти');

  await switchBtn(page).click();
  await expect(title(page)).toHaveText('Вход');
  await expect(submit(page)).toHaveText('Войти');
  await expect(password(page)).toHaveAttribute('autocomplete', 'current-password');
  await expect(sub(page)).toContainText('Войдите');
});

test('автофокус почты не отнимает поле, в которое человек успел встать раньше таймера', async ({ page }) => {
  await open(page);
  // Менеджер паролей или тап по паролю на медленном телефоне: человек уже в
  // поле пароля, а отложенный фокус на почту ещё не сработал.
  await page.evaluate(() => { openAuthModal(); document.getElementById('auth-password').focus(); });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150))); // с запасом к 30 мс таймера
  await expect(password(page), 'таймер не перетащил фокус на почту').toBeFocused();
  await password(page).fill(PASSWORD);
  await expect(email(page)).toHaveValue('');
  await expect(password(page)).toHaveValue(PASSWORD);
});

test('при переключении режима почта и пароль остаются, ошибка уходит; Google — в обоих режимах', async ({ page }) => {
  await open(page);
  await openAuth(page);
  await fill(page);
  await page.evaluate(() => showAuthError('auth.error_generic'));
  await expect(error(page)).toBeVisible();

  for (const mode of ['signup', 'signin']) {
    await switchBtn(page).click();
    await expect(email(page)).toHaveValue(EMAIL);
    await expect(password(page)).toHaveValue(PASSWORD);
    await expect(error(page), `ошибка не переезжает в режим ${mode}`).toBeHidden();
    await expect(page.locator('#auth-google-btn')).toBeVisible();
  }
});

test('строка-переключатель стоит внизу формы, под кнопками', async ({ page }) => {
  await open(page);
  await openAuth(page);
  const box = (loc) => loc.boundingBox();
  const btns = await box(submit(page));
  const sw = await box(switchBtn(page));
  expect(sw.y, 'переключатель ниже главной кнопки').toBeGreaterThan(btns.y + btns.height);
  const modal = await box(page.locator('#auth-backdrop .modal'));
  expect(sw.y + sw.height, 'и не вылезает из окна').toBeLessThanOrEqual(modal.y + modal.height);
});

test('«Создать аккаунт» в настройках открывает регистрацию, «Войти» — вход', async ({ page }) => {
  await open(page);
  await page.locator('.nav-item[data-view="settings"]').first().click();

  await page.locator('#settings-signup-btn').click();
  await expect(page.locator('#auth-step-credentials')).toBeVisible();
  await expect(title(page)).toHaveText('Регистрация');
  await expect(submit(page)).toHaveText('Создать аккаунт');
  await expect(password(page)).toHaveAttribute('autocomplete', 'new-password');

  await page.locator('#auth-cancel').click();
  await expect(page.locator('#auth-backdrop')).toBeHidden();

  await page.locator('#settings-signin-btn').click();
  await expect(title(page)).toHaveText('Вход');
  await expect(submit(page)).toHaveText('Войти');
  await expect(password(page)).toHaveAttribute('autocomplete', 'current-password');
});

test('окно, закрытое в режиме регистрации, открывается снова входом — из шапки', async ({ page }) => {
  await open(page);
  await openAuth(page, 'signup');
  await expect(title(page)).toHaveText('Регистрация');
  await page.locator('#auth-cancel').click();
  await page.locator('#account-btn').click();
  await expect(title(page)).toHaveText('Вход');
  await expect(email(page), 'поля чистые').toHaveValue('');
});

test('регистрация зовёт signUp с введёнными почтой и паролем и ведёт к шагу согласия', async ({ page }) => {
  await open(page);
  await stub(page, { signUp: { data: { user: { id: 'u1' }, session: { access_token: 'x' } }, error: null } });
  await openAuth(page, 'signup');
  await fill(page);
  await submit(page).click();

  await expect(page.locator('#auth-step-onboarding')).toBeVisible();
  await expect(page.locator('#auth-step-credentials')).toBeHidden();
  expect(await calls(page), 'сессия пришла сразу — отдельный вход не нужен').toEqual([
    ['signUp', { email: EMAIL, password: PASSWORD }],
  ]);
  // Правовой шаг на месте: без согласия дальше не пройти.
  await expect(page.locator('#auth-consent-check')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#auth-onboarding-save')).toBeDisabled();
  await expect(page.locator('#auth-onboarding-skip')).toBeDisabled();
  await expect(page.locator('#auth-consent-text a[data-legal="terms"]')).toBeVisible();
  await expect(page.locator('#auth-consent-text a[data-legal="privacy"]')).toBeVisible();
  await expect(page.locator('#auth-consent-text')).toContainText('16');
});

test('Enter в поле пароля в режиме регистрации тоже регистрирует, а не входит', async ({ page }) => {
  await open(page);
  await stub(page, { signUp: { data: { user: { id: 'u1' }, session: { access_token: 'x' } }, error: null } });
  await openAuth(page, 'signup');
  await fill(page);
  await password(page).press('Enter');
  await expect(page.locator('#auth-step-onboarding')).toBeVisible();
  expect(await calls(page)).toEqual([['signUp', { email: EMAIL, password: PASSWORD }]]);
});

test('сервер не отдал сессию — после регистрации входим тем же паролем', async ({ page }) => {
  await open(page);
  await stub(page, { signUp: { data: { user: { id: 'u1' }, session: null }, error: null } });
  await openAuth(page, 'signup');
  await fill(page);
  await submit(page).click();
  await expect(page.locator('#auth-step-onboarding')).toBeVisible();
  expect(await calls(page)).toEqual([
    ['signUp', { email: EMAIL, password: PASSWORD }],
    ['signIn', { email: EMAIL, password: PASSWORD }],
  ]);
});

// Три лица одного ответа «такой аккаунт уже есть»: новый сервер (код), старый
// (только текст) и сервер с подтверждением почты (ошибки нет, пользователь
// «пустой», без identities).
const EXISTS = {
  'по коду': { data: { user: null, session: null }, error: { code: 'user_already_exists', message: 'User already registered', status: 422 } },
  'по тексту': { data: { user: null, session: null }, error: { message: 'User already registered', status: 400 } },
  'по пустому пользователю': { data: { user: { id: 'ghost', identities: [] }, session: null }, error: null },
};
for (const [how, signUp] of Object.entries(EXISTS)) {
  test(`аккаунт уже есть (${how}): говорим об этом и переключаем на вход, почта и пароль на месте`, async ({ page }) => {
    await open(page);
    await stub(page, { signUp });
    await openAuth(page, 'signup');
    await fill(page);
    await submit(page).click();

    await expect(title(page)).toHaveText('Вход');
    await expect(submit(page)).toHaveText('Войти');
    await expect(error(page)).toBeVisible();
    await expect(error(page)).toHaveText('Аккаунт с таким email уже есть. Войдите в него.');
    await expect(email(page)).toHaveValue(EMAIL);
    await expect(password(page)).toHaveValue(PASSWORD);
    await expect(page.locator('#auth-step-onboarding')).toBeHidden();
    expect(await calls(page), 'вход сам не пробуем — пароль мог быть чужим').toEqual([
      ['signUp', { email: EMAIL, password: PASSWORD }],
    ]);
    await expect(submit(page), 'кнопка снова доступна').toBeEnabled();
  });
}

test('слабый пароль: называем требование и остаёмся в регистрации', async ({ page }) => {
  await open(page);
  await stub(page, {
    signUp: { data: { user: null, session: null }, error: { code: 'weak_password', message: 'Password should be at least 6 characters.', status: 422, reasons: ['length'] } },
  });
  await openAuth(page, 'signup');
  await email(page).fill(EMAIL);
  await password(page).fill('123');
  await submit(page).click();
  await expect(error(page)).toHaveText('Пароль слишком простой. Минимум 6 символов.');
  await expect(title(page)).toHaveText('Регистрация');
  await expect(password(page)).toHaveValue('123');
  await expect(submit(page)).toBeEnabled();
});

test('прочая ошибка регистрации — общий текст', async ({ page }) => {
  await open(page);
  await stub(page, { signUp: { data: { user: null, session: null }, error: { message: 'Network request failed', status: 500 } } });
  await openAuth(page, 'signup');
  await fill(page);
  await submit(page).click();
  await expect(error(page)).toHaveText('Что-то пошло не так. Попробуйте ещё раз.');
  await expect(title(page)).toHaveText('Регистрация');
});

// Два лица одного ответа «неверная пара»: старый сервер (только текст) и новый
// (код invalid_credentials).
const INVALID = {
  'по тексту': { message: 'Invalid login credentials', status: 400 },
  'по коду': { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
};
for (const [how, signIn] of Object.entries(INVALID)) {
  test(`неверный пароль (${how}): красная ошибка «Неверный email или пароль», а предложение создать аккаунт — рядом`, async ({ page }) => {
    await open(page);
    await stub(page, { signUp: { data: {}, error: null }, signIn: { data: {}, error: signIn } });
    await openAuth(page);
    await fill(page);
    await submit(page).click();

    // Раньше менялась только приглушённая строка внизу — человек с опечаткой
    // в пароле не видел, что вход не удался.
    await expect(error(page)).toBeVisible();
    await expect(error(page)).toHaveText('Неверный email или пароль.');
    await expect(error(page), 'ошибка красная, как все остальные').toHaveCSS('color', await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--danger)';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    }));
    await expect(switchText(page), 'и предложение зарегистрироваться — рядом').toHaveText('Нет аккаунта с таким email.');
    await expect(switchBtn(page)).toHaveText('Создать аккаунт');
    await expect(email(page), 'почта и пароль на месте').toHaveValue(EMAIL);
    await expect(password(page)).toHaveValue(PASSWORD);
    await expect(submit(page)).toBeEnabled();
  });
}

test('после неверного пароля исправленный пароль пускает дальше', async ({ page }) => {
  await open(page);
  await stub(page, { signUp: { data: {}, error: null }, signIn: { data: {}, error: { message: 'Invalid login credentials', status: 400 } } });
  await openAuth(page);
  await fill(page);
  await submit(page).click();
  await expect(error(page)).toHaveText('Неверный email или пароль.');
  // Пароль исправлен — сервер теперь пускает.
  await page.evaluate(() => { sb.auth.signInWithPassword = async () => ({ data: {}, error: null }); });
  await submit(page).click();
  await expect(page.locator('#auth-step-onboarding')).toBeVisible();
});

test('неудачный вход «invalid login credentials» предлагает зарегистрироваться — с сохранённой почтой', async ({ page }) => {
  await open(page);
  await stub(page, {
    signUp: { data: {}, error: null },
    signIn: { data: {}, error: { message: 'Invalid login credentials', status: 400 } },
  });
  await openAuth(page);
  await fill(page);
  await submit(page).click();

  await expect(switchText(page)).toHaveText('Нет аккаунта с таким email.');
  await expect(switchBtn(page)).toHaveText('Создать аккаунт');
  await expect(title(page), 'сам режим не меняется — выбор за человеком').toHaveText('Вход');
  await expect(submit(page)).toBeEnabled();

  await switchBtn(page).click();
  await expect(title(page)).toHaveText('Регистрация');
  await expect(email(page)).toHaveValue(EMAIL);
  await expect(password(page)).toHaveValue(PASSWORD);
  await expect(switchText(page), 'подсказка про отсутствующий аккаунт ушла вместе с режимом').toHaveText('Уже есть аккаунт?');
});

test('прочая ошибка входа не предлагает регистрацию, а говорит общим текстом', async ({ page }) => {
  await open(page);
  await stub(page, { signUp: { data: {}, error: null }, signIn: { data: {}, error: { message: 'Email not confirmed', status: 400 } } });
  await openAuth(page);
  await fill(page);
  await submit(page).click();
  await expect(error(page)).toHaveText('Что-то пошло не так. Попробуйте ещё раз.');
  await expect(error(page), 'это не «неверный пароль»').not.toHaveText(/Неверный/);
  await expect(switchText(page)).toHaveText('Нет аккаунта?');
});

// Все новые строки — на четырёх языках. Литералы здесь намеренно дублируют
// словарь: тест на parity ключей ловит пропуск, а этот — ещё и то, что
// строка дошла до экрана в нужном месте.
const STR = {
  ru: {
    signin: 'Вход', signup: 'Регистрация', go: 'Войти', create: 'Создать аккаунт',
    noAcc: 'Нет аккаунта?', haveAcc: 'Уже есть аккаунт?',
    exists: 'Аккаунт с таким email уже есть. Войдите в него.', weak: 'Пароль слишком простой. Минимум 6 символов.',
    invalid: 'Неверный email или пароль.', noAccount: 'Нет аккаунта с таким email.',
  },
  en: {
    signin: 'Sign in', signup: 'Sign up', go: 'Sign in', create: 'Create account',
    noAcc: 'No account yet?', haveAcc: 'Already have an account?',
    exists: 'An account with this email already exists. Sign in to it.', weak: 'This password is too weak. Use at least 6 characters.',
    invalid: 'Wrong email or password.', noAccount: 'No account with this email yet.',
  },
  uk: {
    signin: 'Вхід', signup: 'Реєстрація', go: 'Увійти', create: 'Створити акаунт',
    noAcc: 'Немає акаунта?', haveAcc: 'Вже є акаунт?',
    exists: 'Акаунт із таким email уже є. Увійдіть у нього.', weak: 'Пароль занадто простий. Мінімум 6 символів.',
    invalid: 'Невірний email або пароль.', noAccount: 'Немає акаунта з таким email.',
  },
  kk: {
    signin: 'Кіру', signup: 'Тіркелу', go: 'Кіру', create: 'Аккаунт құру',
    noAcc: 'Аккаунтыңыз жоқ па?', haveAcc: 'Аккаунтыңыз бар ма?',
    exists: 'Бұл email-мен аккаунт бұрыннан бар. Оған кіріңіз.', weak: 'Құпия сөз тым оңай. Кемінде 6 таңба қолданыңыз.',
    invalid: 'Email немесе құпия сөз қате.', noAccount: 'Бұл email-мен аккаунт жоқ.',
  },
};
for (const [lang, s] of Object.entries(STR)) {
  test(`окно входа и регистрации на языке «${lang}»`, async ({ page }) => {
    await open(page);
    await page.evaluate((l) => { state.settings.lang = l; applyStaticTranslations(); }, lang);
    await openAuth(page);
    await expect(title(page)).toHaveText(s.signin);
    await expect(submit(page)).toHaveText(s.go);
    await expect(switchText(page)).toHaveText(s.noAcc);
    await expect(switchBtn(page)).toHaveText(s.create);

    await switchBtn(page).click();
    await expect(title(page)).toHaveText(s.signup);
    await expect(submit(page)).toHaveText(s.create);
    await expect(switchText(page)).toHaveText(s.haveAcc);
    await expect(switchBtn(page)).toHaveText(s.go);
    const ru = STR.ru;
    if (lang !== 'ru') {
      await expect(sub(page), 'подзаголовок регистрации переведён').not.toContainText('Создайте аккаунт');
      expect(s.signup).not.toBe(ru.signup);
    }

    // Ответы сервера — тоже на языке приложения.
    await stub(page, { signUp: { data: { user: null, session: null }, error: { code: 'weak_password', message: 'Password should be at least 6 characters.', reasons: ['length'] } } });
    await fill(page);
    await submit(page).click();
    await expect(error(page)).toHaveText(s.weak);

    await page.evaluate(() => { sb.auth.signUp = async () => ({ data: { user: null, session: null }, error: { code: 'user_already_exists', message: 'User already registered' } }); });
    await submit(page).click();
    await expect(error(page)).toHaveText(s.exists);
    await expect(title(page)).toHaveText(s.signin);

    // И неверный пароль: красная ошибка и подсказка про аккаунт — оба на языке окна.
    await page.evaluate(() => { sb.auth.signInWithPassword = async () => ({ data: {}, error: { message: 'Invalid login credentials', status: 400 } }); });
    await submit(page).click();
    await expect(error(page)).toHaveText(s.invalid);
    await expect(switchText(page)).toHaveText(s.noAccount);
  });
}

test('смена языка при открытом окне переписывает и динамические строки режима', async ({ page }) => {
  await open(page);
  await openAuth(page, 'signup');
  await expect(title(page)).toHaveText('Регистрация');
  await page.evaluate(() => setLang('en'));
  await expect(title(page)).toHaveText('Sign up');
  await expect(submit(page)).toHaveText('Create account');
  await expect(switchText(page)).toHaveText('Already have an account?');
  await expect(switchBtn(page)).toHaveText('Sign in');
});
