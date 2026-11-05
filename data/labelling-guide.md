# ScamSaathi labeling guide

Version 1 (3 Nov 2026). One page. Read it before you label, and re-read it whenever you are unsure.

## The goal

Each row is one message. You decide: is it a scam, what kind, and which manipulation tactics does it use? The model learns from your choices, so **consistency matters more than perfection**. If two people would label the same message differently, the guide needs fixing, not the people.

## Columns

| Column | What to enter |
|---|---|
| text | The message, with personal details removed (see Privacy) |
| is_scam | 1 if it is a scam attempt, 0 if it is legitimate or ordinary |
| scam_type | One value from the list below. Use `none` for legitimate messages |
| tactics | Zero or more tactics, joined with the `|` symbol, no spaces, for example `urgency|fear_threat` |
| language | `en` (English), `hi` (Hindi in Devanagari), `hinglish` (Hindi in English letters, or a mix) |
| source | `public`, `synthetic` (written by an AI or by you), or `volunteer` |
| group_id | Same value for variations of one template, including translations |
| reviewed | `yes` once a person has checked the row, otherwise `no` |
| hard_negative | `1` for a legitimate message that looks like a scam on the surface, otherwise `0` |

## Scam types

| Value | Use when the message... |
|---|---|
| refund | promises a refund or money back (tax, order, bank) |
| kyc | threatens to block an account unless you update KYC or details |
| job_fee | offers a job or internship and asks for a fee |
| lottery | says you won a prize, lottery or lucky draw |
| loan | offers a loan, usually with an upfront fee or an app install |
| digital_arrest | claims to be police, CBI, customs and says you are under arrest or investigation |
| delivery | claims a parcel is held and asks for a fee or details |
| investment | promises guaranteed or very high returns |
| romance | builds a relationship or friendship to ask for money |
| other | any other scam: fake relative, utility disconnection, OTP request, tech support |
| none | not a scam |

## Tactics

Tag every tactic that clearly appears. Do not guess at hidden intent; tag what the words do.

| Tactic | Tag it when the message... | Example |
|---|---|---|
| urgency | pushes you to act now or within a short time | "within 24 hours", "tonight" |
| authority | invokes official power, rules or consequences from a bank, government or police | "RBI rules", "your account will be blocked" |
| fee_demand | asks you to pay a fee to get something | "pay Rs 1,500 registration fee" |
| receive_trick | says you must scan, approve or pay to receive money | "scan the QR to receive your refund" |
| credential_request | asks for OTP, PIN, password, card or bank details, or to log in through a link | "share the OTP", "verify your bank details at [LINK]" |
| secrecy | asks you to keep it private or not to check with others | "do not tell anyone", "don't call" |
| too_good | promises something unrealistic | "guaranteed 30% weekly profit" |
| fear_threat | threatens arrest, blocking, disconnection or harm | "you will be arrested" |
| impersonation | pretends to be a named organisation or a person you know | "this is SBI", "Hi Dad, new number" |

## Rules for tricky cases

1. **Judge the message, not the topic.** A genuine bank alert mentions money and OTPs; that does not make it a scam. A message is a scam only if it tries to deceive or pressure you.
2. **Legitimate messages that look scary are valuable.** Real OTP messages, real KYC reminders, real refund notices and real debit alerts must be added as legitimate with `hard_negative = 1`. Aim for many of these.
3. **Unsure whether it is a scam?** Do not guess. Leave it out of the dataset, or add it with `reviewed = no` and ask someone else.
4. **Translations and rewordings share a group_id.** This keeps the same scam from appearing in both training and test data.
5. **Do not copy the same sentence twice.** Near-duplicates inflate the numbers without teaching the model anything.
6. **Mixed language:** if the message is mostly Hindi words in English letters, use `hinglish`. If it is in Devanagari script, use `hi`. If it is English with one or two Hindi words, use `en`.

## Privacy: remove these before a message enters the dataset

- Phone numbers, so replace with `[PHONE]`
- Web addresses, so replace with `[LINK]`
- Names of real people, so replace with `[NAME]`
- UPI IDs, email addresses, account, card and Aadhaar numbers: remove completely
- Company names of real, legitimate businesses may stay, because scams imitate them

Messages from volunteers must be shared with their consent and cleaned before they are saved. Never commit the original screenshots or raw messages. Keep them in `data/private/`, which Git ignores.

## Weekly routine

1. Label or generate about 20000 rows.
2. Run `node scripts/validate-dataset.ts data/your-file.csv` and fix every error.
3. Once a week, give a friend 10 percent of the rows to label without looking at yours. Compare. Every disagreement shows where this guide is unclear; fix the guide and note the change below.

## Change log

- v1: first version.