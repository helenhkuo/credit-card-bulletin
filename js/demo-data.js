/* Sample data used only when apiUrl is empty — so you can preview the UI offline. */
window.CCB_DEMO = {
  benefits: [
    {
      id: "demo-uber",
      person: "C",
      card: "Amex Platinum",
      benefit: "Uber Cash",
      category: "Dining",
      amount: "$15 / month",
      frequency: "monthly",
      expiration: "",
      used_period: "",
      notes: "Demo row — connect Sheets to replace"
    },
    {
      id: "demo-dining",
      person: "C",
      card: "Amex Gold",
      benefit: "Dining Credit",
      category: "Dining",
      amount: "$10 / month",
      frequency: "monthly",
      expiration: "",
      used_period: "",
      notes: ""
    },
    {
      id: "demo-hotel",
      person: "H",
      card: "Chase Sapphire Preferred",
      benefit: "Hotel Credit",
      category: "Hotel",
      amount: "$50 / year",
      frequency: "annual",
      expiration: "",
      used_period: "",
      notes: "Chase Travel"
    },
    {
      id: "demo-used",
      person: "H",
      card: "Marriott Bonvoy",
      benefit: "Free Night Award",
      category: "Hotel Night",
      amount: "1 night",
      frequency: "annual",
      expiration: "2026-08-22",
      used_period: "2026-08-22",
      notes: "Anniversary date anchor"
    }
  ],
  spends: [
    {
      id: "demo-msr",
      person: "C",
      card: "Amex Platinum",
      label: "New card spend",
      goal: 8000,
      spent: 2450,
      deadline: "2026-10-05",
      notes: "Welcome bonus MSR — due soon (demo)"
    },
    {
      id: "demo-retain",
      person: "H",
      card: "Chase Sapphire Preferred",
      label: "Retention",
      goal: 5000,
      spent: 5000,
      deadline: "2027-03-15",
      notes: ""
    }
  ]
};
