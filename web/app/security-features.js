import {button} from '../ui-original/presentation.js';
import {AppError} from './transport.js';

const names=['current_password','password','confirm_password'];
const clearFields=form=>{for(const field of form?.querySelectorAll('input[type="password"]')??[]){field.value='';field.defaultValue='';field.removeAttribute('value');}};
const clearData=form=>{for(const name of names)form.delete(name);};
const field=(name,label,autocomplete)=>`<div class="field"><label for="owner-${name}">${label}</label><input id="owner-${name}" name="${name}" type="password" required maxlength="300"${name==='current_password'?'':' minlength="16"'} autocomplete="${autocomplete}" spellcheck="false" autocapitalize="none" aria-describedby="owner-password-help owner-password-error"></div>`;
const formHTML=()=>`<p class="modal-copy" id="owner-password-help">Use 16–300 characters for your new password. Changing it signs out your other owner sessions. This browser stays signed in, and connected providers keep updating.</p><form data-form="owner-password" novalidate>${field('current_password','Current password','current-password')}${field('password','New password','new-password')}${field('confirm_password','Confirm new password','new-password')}<p class="login-error hidden" id="owner-password-error" role="alert" tabindex="-1"></p><p class="source-note" data-password-status role="status" aria-live="polite"></p><div class="action-row"><button type="submit" class="btn primary">Change password</button>${button('owner-password-cancel','Cancel')}</div></form>`;

/** The server owns rotation, cookie renewal and the provider vault. No draft
 * values, passwords or response credentials enter application state/storage. */
export function createSecurityFeatures(){
 const states=new WeakMap();
 const current=(api,state)=>!!state&&states.get(api)===state&&api.state.active&&api.state.bootstrap?.session===state.session&&state.session.role==='owner'&&api.state.team===state.team&&api.state.season===state.season&&api.state.modal===state.modal&&state.form.isConnected&&api.host.querySelector('form[data-form="owner-password"]')===state.form&&!api.host.querySelector('#accountModal')?.classList.contains('hidden');
 const cleanup=api=>{const state=states.get(api);if(!state)return;state.form.ownerDocument.defaultView?.removeEventListener('pagehide',state.pageHide);clearFields(state.form);state.form.remove();states.delete(api);};
 const report=(state,message,invalid=[])=>{for(const input of state.form.querySelectorAll('input'))input.setAttribute('aria-invalid',String(invalid.includes(input.name)));const error=state.form.querySelector('#owner-password-error');error.textContent=message;error.classList.remove('hidden');error.focus();};
 const busy=(state,value)=>{state.busy=value;state.form.setAttribute('aria-busy',String(value));for(const input of state.form.querySelectorAll('input,button[type="submit"]'))input.disabled=value;state.form.querySelector('[data-password-status]').textContent=value?'Changing password… You can close this form, but a submitted change may still finish.':'';state.form.querySelector('[data-action="owner-password-cancel"]').textContent=value?'Close':'Cancel';};
 const open=async api=>{
   if(!api.state.active)return;
   const epoch=api.state.routeEpoch,session=api.state.bootstrap.session;
   if(api.state.editorDirty&&!await api.canLeave())return;
   if(!api.state.active||api.state.routeEpoch!==epoch||api.state.bootstrap.session!==session)return;
   if(session.role!=='owner')return;
   cleanup(api);api.openModal({title:'Change owner password',kind:'owner-password',html:formHTML()});
   const form=api.host.querySelector('form[data-form="owner-password"]');
   const state={form,modal:api.state.modal,session:api.state.bootstrap.session,team:api.state.team,season:api.state.season,busy:false};
   state.pageHide=()=>{if(current(api,state))api.closeModal();else cleanup(api);};
   states.set(api,state);form.ownerDocument.defaultView?.addEventListener('pagehide',state.pageHide);
   form.querySelector('[name="current_password"]').focus();
 };
 const actions={
  'owner-password':(_,api)=>{api.requireOwner();return open(api);},
  'owner-password-cancel':(_,api)=>{if(current(api,states.get(api))){cleanup(api);api.closeModal();}},
 };
 const forms={
  'owner-password':async(form,_,api)=>{
   const state=states.get(api);
   if(!current(api,state)||state.busy){clearData(form);if(state?.busy)await state.pending?.catch(()=>{});return;}
   let currentPassword=form.get('current_password'),password=form.get('password'),confirmation=form.get('confirm_password'),payload;
   clearData(form);clearFields(state.form);
   try{
    api.requireOwner();
    if(typeof currentPassword!=='string'||!currentPassword||currentPassword.length>300){report(state,'Enter your current password.', ['current_password']);return;}
    if(typeof password!=='string'||password.length<16||password.length>300){report(state,'Use a new password between 16 and 300 characters.', ['password']);return;}
    if(password!==confirmation){report(state,'The new passwords do not match. Enter all three fields again.', ['password','confirm_password']);return;}
    payload={current_password:currentPassword,password};currentPassword=password=confirmation=null;
    state.form.querySelector('#owner-password-error').classList.add('hidden');for(const input of state.form.querySelectorAll('input'))input.removeAttribute('aria-invalid');busy(state,true);
    state.pending=api.transport.command('/api/owner/password',payload,{method:'PUT'});
    const result=await state.pending;
    if(!current(api,state)||result.discarded)return;
    if(result.data?.ok!==true||result.data?.role!=='owner')throw new AppError('Password change could not be confirmed.','invalid_response');
    // Cookie renewal is handled by same-origin transport, never by JavaScript.
    api.closeModal();api.notice('Owner password changed. This browser is signed in; other owner sessions were signed out. Connected providers keep updating.');
   }catch(error){
    if(!current(api,state))return;
    if(error?.code==='sign_in_required'||error?.code==='password_changed')throw new AppError('Your owner session ended. Sign in again with your current password.','sign_in_required',401);
    const errors={password_incorrect:'The current password is incorrect. Enter all three fields again.',password_invalid:'Use a new password between 16 and 300 characters.',rate_limited:'Too many password attempts. Wait a little before trying again.',installation_maintenance:'myTS is being updated. Wait for the update to finish before trying again.'};
    report(state,errors[error?.code]??'The password change could not be confirmed. It may have completed. If your old password no longer works, sign in with the new password.',error?.code==='password_incorrect'?['current_password']:[]);
   }finally{
    currentPassword=password=confirmation=null;if(payload){payload.current_password=null;payload.password=null;payload=null;}
    state.pending=null;clearData(form);clearFields(state.form);if(current(api,state))busy(state,false);
   }
  },
 };
 return {actions,forms,cleanup,settingsEntry:api=>api.state.bootstrap?.session?.role==='owner'?`<div class="account-preference" data-owner-security><div><b>Owner password</b><small>Change your password and sign out other owner sessions.</small></div>${button('owner-password','Change password')}</div>`:''};
}
