import { test, expect } from '@playwright/test';

const HTML_ROUTES = [
  '/',
  '/about/',
  '/practice-areas/',
  '/practice-areas/corporate-commercial/',
  '/practice-areas/contracts-agreements/',
  '/practice-areas/startups-compliance/',
  '/practice-areas/dispute-resolution-arbitration/',
  '/practice-areas/real-estate-rera/',
  '/practice-areas/banking-finance-nclt-drt/',
  '/practice-areas/intellectual-property/',
  '/practice-areas/employment-labour/',
  '/practice-areas/taxation-regulatory/',
  '/team/',
  '/insights/',
  '/insights/company-incorporation-uttar-pradesh/',
  '/insights/drafting-enforceable-commercial-contracts-india/',
  '/insights/cheque-bounce-section-138-ni-act-process/',
  '/insights/up-rera-complaint-process-lucknow/',
  '/insights/trademark-registration-process-india/',
  '/insights/arbitration-vs-civil-litigation-commercial-disputes/',
  '/insights/startup-legal-checklist-india/',
  '/insights/gst-regulatory-compliance-msme-uttar-pradesh/',
  '/insights/employment-contracts-non-compete-india/',
  '/insights/nclt-insolvency-basics-creditors/',
  '/faq/',
  '/contact/',
  '/corporate-lawyers-in-lucknow/',
  '/hi/',
  '/privacy-policy/',
  '/terms/',
  '/disclaimer/',
];

const STATIC_ASSETS = ['/robots.txt', '/humans.txt', '/llms.txt', '/rss.xml', '/sitemap-index.xml'];

test.describe('Zodiac Legal — Route, SEO, Schema & Accessibility Smoke Suite', () => {
  for (const route of HTML_ROUTES) {
    test(`route ${route} returns 200, has valid SEO/JSON-LD, 1 H1, and 0 console errors`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      const response = await page.goto(route);
      expect(response?.status()).toBe(200);

      // Single H1 per page
      const h1Count = await page.locator('h1').count();
      expect(h1Count).toBe(1);

      // Title and Meta Description checks
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);
      expect(title.length).toBeLessThanOrEqual(68);

      const metaDesc = await page.locator('meta[name="description"]').getAttribute('content');
      expect(metaDesc).toBeTruthy();
      expect((metaDesc || '').length).toBeLessThanOrEqual(160);

      // Canonical tag present
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('https://zodiaclegal.com');

      // Validate all JSON-LD scripts parse cleanly
      const jsonLdScripts = await page
        .locator('script[type="application/ld+json"]')
        .allTextContents();
      expect(jsonLdScripts.length).toBeGreaterThanOrEqual(2);
      for (const rawJson of jsonLdScripts) {
        expect(() => JSON.parse(rawJson)).not.toThrow();
      }

      expect(consoleErrors).toEqual([]);
    });
  }

  for (const asset of STATIC_ASSETS) {
    test(`static SEO/AEO endpoint ${asset} returns 200`, async ({ request }) => {
      const res = await request.get(asset);
      expect(res.status()).toBe(200);
    });
  }

  test('Consultation form validates required inputs and targets zodiaclegal.lucknow@gmail.com', async ({
    page,
  }) => {
    await page.goto('/contact/?bci=accepted');
    const submitBtn = page.locator('#zl-submit-btn');
    await submitBtn.click();

    const statusBox = page.locator('#zl-form-status');
    await expect(statusBox).toBeVisible();
    await expect(page.locator('#zl-form-status-text')).toContainText('Please enter your full name');

    // Fill form and check that direct mailto link targets zodiaclegal.lucknow@gmail.com
    await page.fill('#zl-full-name', 'Rajeshwar Prasad');
    await page.fill('#zl-phone', '+91 98390 10163');
    await page.fill('#zl-email', 'rajeshwar@example.com');
    await page.selectOption('#zl-practice-area', 'corporate-commercial');
    await page.fill(
      '#zl-message',
      'We require legal assistance with commercial contract architecture and corporate governance.'
    );
    await page.check('#zl-bci-consent');
    await submitBtn.click();

    await expect(statusBox).toBeVisible();
    const directEmailLink = page.locator('#zl-direct-email-link');
    const href = await directEmailLink.getAttribute('href');
    expect(href).toContain('mailto:zodiaclegal.lucknow@gmail.com');
  });

  test('Responsive design tests: mobile, tablet, and desktop viewports have zero horizontal overflow', async ({
    page,
  }) => {
    const viewports = [
      { name: 'Small Mobile (360x640)', width: 360, height: 640 },
      { name: 'Mobile (375x812)', width: 375, height: 812 },
      { name: 'Tablet (768x1024)', width: 768, height: 1024 },
      { name: 'Desktop (1440x900)', width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of [
        '/?bci=accepted',
        '/insights/company-incorporation-uttar-pradesh/?bci=accepted',
      ]) {
        await page.goto(route);

        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isOverflowing, `Route ${route} overflowed horizontally on ${vp.name}`).toBe(false);
      }

      await page.goto('/?bci=accepted');
      if (vp.width < 1024) {
        await expect(page.locator('#mobile-menu-btn')).toBeVisible();
      } else {
        await expect(page.locator('nav[aria-label="Primary Navigation"]')).toBeVisible();
      }
    }
  });

  test('Mobile BCI disclaimer modal shows visible, unclipped accept button and allows entering site on mobile screens', async ({
    browser,
  }) => {
    for (const vp of [
      { name: 'iPhone SE (320x568)', width: 320, height: 568 },
      { name: 'Android (360x640)', width: 360, height: 640 },
      { name: 'iPhone 13 (390x664)', width: 390, height: 664 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: true,
        hasTouch: true,
      });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      const page = await context.newPage();
      await page.goto('/');

      const dialog = page.locator('#bci-disclaimer-modal');
      const acceptBtn = page.locator('#bci-accept-btn');
      await expect(dialog).toBeVisible();
      await expect(acceptBtn).toBeVisible();

      const metrics = await page.evaluate(() => {
        const d = document.getElementById('bci-disclaimer-modal')!;
        const b = document.getElementById('bci-accept-btn')!;
        const dRect = d.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const style = window.getComputedStyle(d);
        return {
          overflowY: style.overflowY,
          btnInsideDialog: bRect.bottom <= dRect.bottom + 1 && bRect.top >= dRect.top - 1,
          btnInsideViewport: bRect.bottom <= window.innerHeight + 1 && bRect.top >= 0,
        };
      });

      expect(metrics.overflowY, `Dialog must be scrollable on ${vp.name}`).toBe('auto');
      expect(metrics.btnInsideDialog, `Accept button must not be clipped on ${vp.name}`).toBe(true);
      expect(metrics.btnInsideViewport, `Accept button must be in viewport on ${vp.name}`).toBe(
        true
      );

      await acceptBtn.click();
      await expect(dialog).toBeHidden();
      await context.close();
    }
  });
});
