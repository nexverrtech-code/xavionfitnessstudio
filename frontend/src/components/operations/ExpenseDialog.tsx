import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextField, TextareaField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { expensesApi } from '@/services/endpoints'
import { expenseSchema, type ExpenseValues } from '@/schemas/billing'
import type { Expense } from '@/types'
import { applyServerErrors } from '@/utils/forms'
import { CATEGORY_LABELS, paiseToRupees, rupeesToPaise, todayISO } from '@/utils/format'

export function ExpenseDialog({ open, onClose, expense }: { open: boolean; onClose: () => void; expense?: Expense | null }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setError, formState } = useForm<ExpenseValues>({ resolver: zodResolver(expenseSchema) })

  useEffect(() => {
    if (!open) return
    reset(
      expense
        ? { category: expense.category, amount: paiseToRupees(expense.amount), description: expense.description ?? '', expense_date: expense.expense_date }
        : { category: 'RENT', amount: '', description: '', expense_date: todayISO() },
    )
  }, [open, expense, reset])

  const submit = handleSubmit(async (values) => {
    const body = { category: values.category, amount: rupeesToPaise(values.amount), description: values.description || null, expense_date: values.expense_date || null }
    try {
      if (expense) await expensesApi.update(expense.id, body)
      else await expensesApi.create(body)
      invalidate('expenses', 'dashboard')
      toast.success(expense ? 'Expense updated' : 'Expense recorded')
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={expense ? 'Edit expense' : 'Add expense'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" loading={formState.isSubmitting}>
            {expense ? 'Save' : 'Add expense'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <SelectField label="Category" required options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} {...register('category')} />
        <TextField label="Amount" required inputMode="decimal" leading="₹" error={formState.errors.amount?.message} {...register('amount')} data-autofocus />
        <TextField label="Date" type="date" max={todayISO()} wrapperClassName="sm:col-span-2" error={formState.errors.expense_date?.message} {...register('expense_date')} />
        <TextareaField label="Description" rows={2} wrapperClassName="sm:col-span-2" placeholder="e.g. September electricity bill" error={formState.errors.description?.message} {...register('description')} />
      </form>
    </Dialog>
  )
}
