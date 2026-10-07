// "Back" inside the app. A page opened straight from a bookmark or a new tab
// has no app history behind it: navigate(-1) would do nothing or leave the
// app, so it goes home instead. React Router numbers its entries in
// history.state.idx, starting at 0 for the first page of the tab.
export function goBack(navigate) {
  if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
  else navigate("/", { replace: true });
}
