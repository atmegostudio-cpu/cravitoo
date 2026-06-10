"""
Capture 6 iPhone-13-Pro sized screenshots of Cravitoo mobile flows.
Saves to /app/frontend/public/demo-screens/ so user can download via URL.
"""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "https://corporate-feast.preview.emergentagent.com")
OUT_DIR = Path("/app/frontend/public/demo-screens")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# iPhone 13 Pro: 390 x 844 logical pixels, DPR 3 → real PNG 1170x2532
DEVICE_VIEWPORT = {"width": 390, "height": 844}
DEVICE_DPR = 3
USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"


async def shoot(context, url, out_name, prepare=None, post_nav=None):
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)
    # Dismiss cookie banner if any
    try:
        await page.click("text=Got it", timeout=1500)
    except Exception:
        pass
    await page.wait_for_timeout(400)
    if prepare:
        await prepare(page)
    if post_nav:
        await post_nav(page)
    await page.wait_for_timeout(1500)
    out_path = OUT_DIR / out_name
    await page.screenshot(path=str(out_path), full_page=False)
    print(f"  ✓ {out_name}  ({out_path.stat().st_size//1024} KB)")
    await page.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # Context 1: anonymous (Login, OTP, Register)
        ctx_anon = await browser.new_context(
            viewport=DEVICE_VIEWPORT,
            device_scale_factor=DEVICE_DPR,
            is_mobile=True,
            has_touch=True,
            user_agent=USER_AGENT,
        )

        print("📱 Capturing mobile screens at 390×844 (iPhone 13 Pro)…\n")

        # 1. Login (password)
        await shoot(ctx_anon, f"{BASE}/login", "01-login.png")

        # 2. OTP request
        async def to_otp(page):
            await page.click("text=Login with Email Code")
            await page.wait_for_timeout(800)
            await page.fill('input[type="email"]', "info@cravitoo.com")
        await shoot(ctx_anon, f"{BASE}/login", "02-otp-request.png", prepare=to_otp)

        # 3. OTP verify (after sending)
        async def to_otp_verify(page):
            await page.click("text=Login with Email Code")
            await page.wait_for_timeout(500)
            await page.fill('input[type="email"]', "info@cravitoo.com")
            await page.click("text=Send Code")
            await page.wait_for_timeout(3500)
        await shoot(ctx_anon, f"{BASE}/login", "03-otp-verify.png", prepare=to_otp_verify)

        # 4. Register
        async def to_register(page):
            await page.click("text=Create Account")
            await page.wait_for_timeout(1500)
        await shoot(ctx_anon, f"{BASE}/login", "04-register.png", prepare=to_register)

        await ctx_anon.close()

        # Context 2: logged-in employee (Pre-booking + Menu)
        ctx_emp = await browser.new_context(
            viewport=DEVICE_VIEWPORT,
            device_scale_factor=DEVICE_DPR,
            is_mobile=True,
            has_touch=True,
            user_agent=USER_AGENT,
        )
        # Sign in once and reuse the session
        seed_page = await ctx_emp.new_page()
        await seed_page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=30000)
        await seed_page.wait_for_timeout(1500)
        try:
            await seed_page.click("text=Got it", timeout=1500)
        except Exception:
            pass
        await seed_page.fill('input[type="email"]', "info@cravitoo.com")
        await seed_page.fill('input[type="password"]', "Demo@123")
        await seed_page.click('button[type="submit"]')
        await seed_page.wait_for_timeout(3000)
        await seed_page.close()

        # 5. Pre-booking
        await shoot(ctx_emp, f"{BASE}/employee/reservations", "05-pre-booking.png")

        # 6. Menu
        await shoot(ctx_emp, f"{BASE}/employee/menu", "06-menu.png")

        await ctx_emp.close()
        await browser.close()
        print("\n✅ All 6 mobile screenshots saved to /app/frontend/public/demo-screens/")


if __name__ == "__main__":
    asyncio.run(main())
