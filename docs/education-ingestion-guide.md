# Kira — Education Document Ingestion Guide

> **For:** School administrators setting up their Kira AI chatbot
> **Last Updated:** April 2026

---

## Overview

Kira's AI chatbot answers questions using **your documents**. The quality of answers depends entirely on **what you upload**. This guide walks you through which documents to prioritize, how to structure them, and which formats work best.

---

## Quick Start: What to Upload First

Upload these 5 document categories in order of priority:

| Priority | Document Type | Why It Matters | Best Format |
|---|---|---|---|
| 🔴 1 | **Fee Structure** | #1 most-asked question by parents | PDF or Text |
| 🔴 2 | **Admissions FAQ** | Covers eligibility, deadlines, process | Text or URL |
| 🟡 3 | **Course/Program Details** | Students need curriculum, duration, outcomes | PDF (brochure) |
| 🟡 4 | **Contact Information** | Phone numbers, emails, office hours | Text |
| 🟢 5 | **Campus Facilities** | Hostel, transport, labs, library | URL (website page) |

---

## Document Types & Best Practices

### 1. Fee Structures (HIGHEST PRIORITY)

Fee-related questions make up **40–60% of all chatbot queries**. Upload:
- Tuition fees broken down by program and year
- Hostel/accommodation fees
- Scholarship details and eligibility criteria
- Payment schedule and deadlines
- Late fee policies

**Best format:** Plain text or PDF table.

**Example text to upload:**
```
B.Tech Computer Science — Annual Tuition: ₹2,50,000
B.Tech AI & ML — Annual Tuition: ₹2,75,000
MBA — Annual Tuition: ₹3,50,000

Hostel Fee (AC): ₹1,20,000/year
Hostel Fee (Non-AC): ₹85,000/year

Scholarship: 50% tuition waiver for students scoring 95%+ in 12th boards.
Application deadline: June 30, 2026.
```

> ⚠️ **Avoid:** Uploading fee structures as scanned images inside PDFs — the AI cannot read images. Use text-based PDFs or type the fees directly.

---

### 2. Admissions FAQ

Structure as question-answer pairs for best results:

```
Q: What is the eligibility for B.Tech admission?
A: Students must have completed 12th grade with Physics, Chemistry, and
Mathematics, with a minimum aggregate of 60%.

Q: What entrance exams are accepted?
A: We accept JEE Main, KCET, COMEDK, and our internal entrance test (CUET).

Q: When is the last date for admission?
A: Applications close on July 15, 2026. Late applications may be accepted
until July 31 with a ₹5,000 late fee.
```

> 💡 **Tip:** Q&A format produces the **best chatbot responses** because the AI can directly match a user's question to an existing answer.

---

### 3. Course/Program Brochures

Upload your official brochures as PDFs. The AI will extract the text automatically. For each program, include:
- Program name and duration
- Curriculum overview (semester-wise if possible)
- Placement statistics (average package, highest package, top recruiters)
- Faculty highlights
- Specializations available

> ⚠️ **Important:** Marketing brochures with heavy graphics and minimal text don't work well. If your brochure is mostly images, consider typing out the key information as plain text and uploading that instead.

---

### 4. Contact Information

Upload a simple text document with all contact details:

```
Admissions Office: +91-80-4012-3456 | admissions@school.edu
Fee Payment Queries: +91-80-4012-3457 | accounts@school.edu
Hostel Queries: +91-80-4012-3460 | hostel@school.edu

Office Hours: Monday–Friday, 9:00 AM – 5:00 PM
Saturday: 9:00 AM – 1:00 PM (Admissions only)
Sunday: Closed

Campus Address: 123 University Road, Bangalore - 560029
```

---

### 5. Website Pages

Use the **Add URL** feature to ingest your website pages directly:
- Homepage → general school overview
- Admissions page → eligibility and process
- Placement page → statistics and recruiter list
- Department pages → individual program details

For comprehensive coverage, use **Crawl Website** — this will automatically follow internal links and ingest up to 100 pages from your domain.

> 💡 **Tip:** Crawling your entire website is the fastest way to give Kira a comprehensive knowledge base. Start with a depth of 3 and max 50 pages.

---

## Upload Methods

| Method | Best For | How to Use |
|---|---|---|
| **Upload PDF** | Brochures, fee structure PDFs, circulars | Dashboard → Documents → Upload PDF |
| **Add URL** | Individual website pages | Dashboard → Documents → Add URL |
| **Add Text** | Quick FAQ entries, contact info | Dashboard → Documents → Add Text |
| **Crawl Website** | Entire school website | Dashboard → Documents → Crawl Website |
| **Add YouTube** | Campus tours, orientation videos | Dashboard → Documents → Add YouTube |

---

## What NOT to Upload

| ❌ Avoid | Why |
|---|---|
| Scanned image PDFs | AI cannot read text from images |
| Password-protected PDFs | Extraction will fail |
| Internal HR/salary documents | Could leak in chatbot responses |
| Student personal data (grades, IDs) | Privacy/compliance violation |
| Files larger than 5 MB | Will be rejected by the system |
| Duplicate content | Wastes storage and can confuse the AI |

---

## Maximizing Chatbot Quality

### Do's ✅
- **Update documents regularly** — delete outdated fee structures and re-upload current ones
- **Use clear headings** — "B.Tech Fees 2026-27" is better than "Fees"
- **Include numbers** — specific amounts, dates, and percentages give precise answers
- **Cover edge cases** — "What if I miss the deadline?", "Can I pay in installments?"
- **Test after uploading** — ask Kira the questions parents will ask and verify the answers

### Don'ts ❌
- Don't upload the same document twice (it creates duplicate chunks)
- Don't upload content in regional languages unless your chatbot is configured for that language
- Don't upload blank or near-empty files
- Don't include confidential or internal-only information

---

## Testing Your Knowledge Base

After uploading documents, test these common questions:

1. "What is the fee for [your most popular program]?"
2. "What are the admission requirements?"
3. "What is the last date for admission?"
4. "Do you offer scholarships?"
5. "What is the placement record?"
6. "How do I contact the admissions office?"
7. "Is hostel available? What's the cost?"

If Kira can answer all 7 accurately, your knowledge base is in good shape.

---

## Need Help?

Contact the Kira team:
- **Technical issues:** support@cyclecorp.in
- **Onboarding assistance:** Coordinate with Meedhash for dashboard walkthrough
