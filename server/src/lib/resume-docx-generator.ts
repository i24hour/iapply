import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} from 'docx';

type ParsedResume = Record<string, any>;
type ProfileRecord = Record<string, any> | null;

type ExperienceRow = {
  title: string;
  company: string;
  date: string;
  bullets: string[];
};

type EducationRow = {
  institution: string;
  degree: string;
  field: string;
  date: string;
};

export interface ResumeDocxInput {
  userEmail: string;
  profile: ProfileRecord;
  latestParsedResume: ParsedResume | null;
  searchQuery?: string;
  jobTitle?: string;
  company?: string;
  jobDescription?: string;
}

const ACCENT = '2D2D2D';
const RULE = '444444';
const DARK = '111111';
const GRAY = '555555';
const MID = '2D2D2D';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (!value) return [];
  return normalizeText(value)
    .split(/[,|]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizePhone(value: unknown) {
  const text = normalizeText(value);
  if (!text) return '';
  return text;
}

function slugify(value: string) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'resume';
}

function buildFileName(input: ResumeDocxInput) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const seed = input.searchQuery || input.jobTitle || input.company || 'general';
  return `priyanshu_${slugify(seed)}_${stamp}.docx`;
}

function createLink(text: string, url: string, size = 19) {
  return new ExternalHyperlink({
    link: url,
    children: [
      new TextRun({
        text,
        style: 'Hyperlink',
        size,
        font: 'Calibri',
        color: '1A56A0',
        underline: { type: UnderlineType.SINGLE, color: '1A56A0' },
      }),
    ],
  });
}

function sectionHeading(text: string) {
  return new Paragraph({
    spacing: { before: 100, after: 32 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 1 } },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 20,
        font: 'Calibri',
        color: ACCENT,
      }),
    ],
  });
}

function jobRow(title: string, company: string, date: string) {
  return new Paragraph({
    spacing: { before: 80, after: 14 },
    tabStops: [{ type: 'right', position: 9312 }],
    children: [
      new TextRun({ text: title, bold: true, size: 20, font: 'Calibri', color: DARK }),
      new TextRun({ text: `  |  ${company}`, size: 19, font: 'Calibri', color: GRAY }),
      new TextRun({ text: `\t${date}`, size: 18, font: 'Calibri', color: GRAY }),
    ],
  });
}

function bullet(text: string) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 22, after: 22 },
    children: [new TextRun({ text, size: 19, font: 'Calibri', color: MID })],
  });
}

function skillRow(label: string, value: string) {
  return new Paragraph({
    spacing: { before: 26, after: 26 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 19, font: 'Calibri', color: DARK }),
      new TextRun({ text: value, size: 19, font: 'Calibri', color: MID }),
    ],
  });
}

function parseExperienceRows(parsed: ParsedResume | null): ExperienceRow[] {
  const work = Array.isArray(parsed?.workExperience) ? parsed?.workExperience : [];
  const rows: ExperienceRow[] = work
    .map((entry: any) => {
      const title = normalizeText(entry?.title) || 'Role';
      const company = normalizeText(entry?.company) || 'Company';
      const start = normalizeText(entry?.startDate || entry?.start || '');
      const end = normalizeText(entry?.endDate || entry?.end || 'Present');
      const date = start || end ? `${start || 'Start'} - ${end || 'Present'}` : 'Recent';
      const bullets = normalizeArray(entry?.description || '').slice(0, 3);
      return {
        title,
        company,
        date,
        bullets: bullets.length ? bullets : ['Delivered measurable outcomes in role ownership and execution.'],
      };
    })
    .slice(0, 4);

  if (rows.length) return rows;

  return [
    {
      title: 'Program Intern',
      company: 'Recent Team',
      date: 'Recent',
      bullets: ['Owned execution across cross-functional projects and improved workflow throughput.'],
    },
  ];
}

function parseEducationRows(parsed: ParsedResume | null, profile: ProfileRecord): EducationRow[] {
  const edu = Array.isArray(parsed?.education) ? parsed?.education : [];
  const rows: EducationRow[] = edu
    .map((entry: any) => {
      const institution = normalizeText(entry?.institution) || 'Institute';
      const degree = normalizeText(entry?.degree) || 'Degree';
      const field = normalizeText(entry?.field) || '';
      const start = normalizeText(entry?.startYear || '');
      const end = normalizeText(entry?.endYear || '');
      const date = start || end ? `${start || ''}${start && end ? ' - ' : ''}${end || ''}`.trim() : 'Recent';
      return { institution, degree, field, date };
    })
    .slice(0, 2);

  if (rows.length) return rows;

  const fallbackInstitute = normalizeText(profile?.college || profile?.institution || 'IIT Roorkee');
  return [
    {
      institution: fallbackInstitute,
      degree: normalizeText(profile?.degree || 'Bachelor of Technology'),
      field: normalizeText(profile?.branch || profile?.major || ''),
      date: normalizeText(profile?.graduation_year || '2022 - 2026'),
    },
  ];
}

function buildSummary(input: ResumeDocxInput) {
  const parsedSummary = normalizeText(input.latestParsedResume?.summary || '');
  if (parsedSummary) return parsedSummary;

  const years = Number(input.profile?.experience_years || input.latestParsedResume?.experienceYears || 0);
  const role = normalizeText(input.searchQuery || input.jobTitle || 'product and operations roles');
  const company = normalizeText(input.company || 'high ownership teams');
  const yearsText = Number.isFinite(years) && years > 0 ? `${years}+ years` : 'hands-on project experience';

  return `Builder-focused candidate targeting ${role}. Brings ${yearsText} across AI automation, execution, and cross-functional delivery. Known for structured problem solving, fast iteration, and shipping outcomes in ${company}.`;
}

function buildSkillGroups(input: ResumeDocxInput) {
  const parsedSkills = normalizeArray(input.latestParsedResume?.skills || []);
  const profileSkills = normalizeArray(input.profile?.skills || []);
  const combined = [...parsedSkills, ...profileSkills];
  const unique = Array.from(new Set(combined.map((s) => s.trim()).filter(Boolean)));

  const technical = unique.filter((s) => /python|sql|typescript|javascript|node|react|next|aws|docker|fastapi|langchain|llm|ai/i.test(s)).slice(0, 12);
  const analytics = unique.filter((s) => /analysis|excel|power bi|tableau|ab test|cohort|finance|model/i.test(s)).slice(0, 10);
  const execution = unique.filter((s) => /stakeholder|communication|coordination|leadership|ops|program|strategy|planning/i.test(s)).slice(0, 10);

  return {
    technical: technical.length ? technical.join(', ') : 'Python, TypeScript, SQL, Next.js, Node.js, FastAPI, AWS',
    analytics: analytics.length ? analytics.join(', ') : 'Data Analysis, Cohort Analysis, A/B Testing, Financial Modelling',
    execution: execution.length ? execution.join(', ') : 'Stakeholder Communication, Structured Problem Solving, Cross-functional Delivery',
  };
}

function buildContactParagraph(input: ResumeDocxInput, fullName: string) {
  const phone = normalizePhone(input.latestParsedResume?.phone || input.profile?.phone || '');
  const email = normalizeText(input.latestParsedResume?.email || input.userEmail || '');
  const location = normalizeText(input.latestParsedResume?.location || input.profile?.location || '');
  const linkedIn = normalizeText(input.latestParsedResume?.linkedin || input.latestParsedResume?.linkedIn || input.profile?.linkedin || '');
  const github = normalizeText(input.latestParsedResume?.github || input.profile?.github || '');

  const contactBits = [phone, email, location].filter(Boolean).join('  |  ');

  const children: Array<TextRun | ExternalHyperlink> = [];
  if (contactBits) {
    children.push(new TextRun({ text: `${contactBits}  |  `, size: 19, font: 'Calibri', color: GRAY }));
  }

  if (linkedIn) {
    const href = linkedIn.startsWith('http') ? linkedIn : `https://${linkedIn}`;
    children.push(createLink('LinkedIn', href, 19));
  }

  if (github) {
    if (children.length) children.push(new TextRun({ text: '  |  ', size: 19, font: 'Calibri', color: GRAY }));
    const href = github.startsWith('http') ? github : `https://${github}`;
    children.push(createLink('GitHub', href, 19));
  }

  if (!children.length) {
    children.push(new TextRun({ text: `${fullName}  |  ${email}`, size: 19, font: 'Calibri', color: GRAY }));
  }

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children,
  });
}

export async function generateResumeDocx(input: ResumeDocxInput) {
  const fullName = normalizeText(input.latestParsedResume?.fullName || input.profile?.full_name || 'Priyanshu').toUpperCase();
  const roleText = normalizeText(input.searchQuery || input.jobTitle || 'Generalist Role');
  const companyText = normalizeText(input.company || '');

  const summary = buildSummary(input);
  const skills = buildSkillGroups(input);
  const experienceRows = parseExperienceRows(input.latestParsedResume);
  const educationRows = parseEducationRows(input.latestParsedResume, input.profile);
  const targetLine = [roleText, companyText].filter(Boolean).join(' at ');

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 28 },
      children: [new TextRun({ text: fullName, bold: true, size: 52, font: 'Calibri', color: DARK })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 28 },
      children: [
        new TextRun({
          text: targetLine ? `Tailored Resume  |  ${targetLine}` : 'Tailored Resume',
          size: 20,
          font: 'Calibri',
          color: GRAY,
        }),
      ],
    }),
    buildContactParagraph(input, fullName),

    sectionHeading('Summary'),
    new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: summary, size: 19, font: 'Calibri', color: MID })],
    }),

    sectionHeading('Skills'),
    skillRow('Technical', skills.technical),
    skillRow('Analytics', skills.analytics),
    skillRow('Execution', skills.execution),

    sectionHeading('Work Experience'),
  ];

  for (const row of experienceRows) {
    children.push(jobRow(row.title, row.company, row.date));
    for (const item of row.bullets) {
      children.push(bullet(item));
    }
  }

  children.push(sectionHeading('Education'));
  for (const edu of educationRows) {
    children.push(
      new Paragraph({
        spacing: { before: 68, after: 14 },
        tabStops: [{ type: 'right', position: 9312 }],
        children: [
          new TextRun({
            text: `${edu.degree}${edu.field ? `, ${edu.field}` : ''}  |  ${edu.institution}`,
            bold: true,
            size: 20,
            font: 'Calibri',
            color: DARK,
          }),
          new TextRun({ text: `\t${edu.date || 'Recent'}`, size: 18, font: 'Calibri', color: GRAY }),
        ],
      })
    );
  }

  if (input.jobDescription) {
    children.push(sectionHeading('Job Fit Notes'));
    children.push(
      bullet(`Target role: ${targetLine || roleText}.`),
      bullet(`JD focus keywords: ${normalizeArray(input.jobDescription).slice(0, 12).join(', ') || 'Tailored to role context.'}`),
    );
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 300, hanging: 180 } } },
            },
          ],
        },
      ],
    },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 19, color: DARK } } },
      characterStyles: [
        {
          id: 'Hyperlink',
          name: 'Hyperlink',
          run: { color: '1A56A0', underline: { type: UnderlineType.SINGLE } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 600, right: 780, bottom: 600, left: 780 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    fileName: buildFileName(input),
    contentType: DOCX_MIME,
  };
}
